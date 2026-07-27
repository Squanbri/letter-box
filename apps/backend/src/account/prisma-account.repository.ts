import { Injectable } from '@nestjs/common';
import type { AccountStatus } from '@letter-box/contracts';
import type { AccountConfig } from '../runtime';
import type { AccountRow } from './account.types';
import { PrismaDatabaseService } from '../database/prisma-database.service';

@Injectable()
export class PrismaAccountRepository {
  constructor(private readonly database: PrismaDatabaseService) {}

  async resetConnectionStatuses(now: string): Promise<void> {
    await this.database.client.account.updateMany({
      data: { status: 'disconnected', updatedAt: new Date(now) },
    });
  }

  async upsertStored(account: AccountConfig, now: string): Promise<void> {
    const timestamp = new Date(now);
    await this.database.client.account.upsert({
      where: { id: account.id },
      create: {
        id: account.id,
        provider: account.provider,
        email: account.email,
        status: 'disconnected',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      update: {
        provider: account.provider,
        email: account.email,
        updatedAt: timestamp,
      },
    });
  }

  async list(userId: string | null): Promise<AccountRow[]> {
    const rows = await this.database.client.account.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      ...this.statusSelection(),
    });
    return rows.map((row) => this.mapRow(row));
  }

  async find(userId: string | null, accountId: string): Promise<AccountRow | undefined> {
    const row = await this.database.client.account.findFirst({
      where: {
        id: accountId,
        ...(userId === null ? {} : { userId }),
      },
      ...this.statusSelection(),
    });
    return row ? this.mapRow(row) : undefined;
  }

  async saveConnected(
    account: AccountConfig,
    userId: string | null,
    now: string,
  ): Promise<void> {
    const timestamp = new Date(now);
    await this.database.client.account.upsert({
      where: { id: account.id },
      create: {
        id: account.id,
        userId,
        provider: account.provider,
        email: account.email,
        status: 'connected',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      update: {
        userId,
        provider: account.provider,
        email: account.email,
        status: 'connected',
        lastError: null,
        updatedAt: timestamp,
      },
    });
  }

  async setStatus(
    accountId: string,
    status: AccountStatus['status'],
    error: string | null,
    now: string,
  ): Promise<void> {
    await this.database.client.account.updateMany({
      where: { id: accountId },
      data: {
        status,
        lastError: error,
        updatedAt: new Date(now),
      },
    });
  }

  async markSynced(accountId: string, now: string): Promise<void> {
    const timestamp = new Date(now);
    await this.database.client.account.updateMany({
      where: { id: accountId },
      data: {
        status: 'connected',
        lastError: null,
        lastSyncAt: timestamp,
        updatedAt: timestamp,
      },
    });
  }

  async remove(userId: string | null, accountId: string): Promise<void> {
    await this.database.client.account.deleteMany({
      where: { id: accountId, ...(userId === null ? {} : { userId }) },
    });
  }

  async clearMailData(accountId: string): Promise<void> {
    await this.database.client.$transaction([
      this.database.client.message.deleteMany({ where: { accountId } }),
      this.database.client.mailboxState.deleteMany({ where: { accountId } }),
    ]);
  }

  private statusSelection() {
    return {
      select: {
        id: true,
        provider: true,
        email: true,
        status: true,
        lastError: true,
        lastSyncAt: true,
        _count: {
          select: {
            messages: {
              where: {
                mailbox: 'INBOX',
                NOT: { flags: { array_contains: ['\\Seen'] } },
              },
            },
          },
        },
      },
    } as const;
  }

  private mapRow(row: {
    id: string;
    provider: string;
    email: string;
    status: string;
    lastError: string | null;
    lastSyncAt: Date | null;
    _count: { messages: number };
  }): AccountRow {
    return {
      id: row.id,
      provider: row.provider as AccountRow['provider'],
      email: row.email,
      status: row.status as AccountRow['status'],
      last_error: row.lastError,
      last_sync_at: row.lastSyncAt?.toISOString() ?? null,
      unread_count: row._count.messages,
    };
  }
}
