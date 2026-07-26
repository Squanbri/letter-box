import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccountConfig, getRuntimeOptions } from '../runtime';
import type { AccountRow } from './account.repository';
import {
  ACCOUNT_REPOSITORY,
  AccountRepositoryContract,
} from '../database/repository.contracts';
import type {
  AccountInput,
  AccountStatus as ContractAccountStatus,
} from '@letter-box/contracts';

export type SaveAccountInput = AccountInput;
export type AccountStatus = ContractAccountStatus;

@Injectable()
export class AccountService implements OnModuleInit {
  private readonly credentials = new Map<string, AccountConfig>();

  constructor(
    @Inject(ACCOUNT_REPOSITORY)
    private readonly repository: AccountRepositoryContract,
  ) {}

  async onModuleInit(): Promise<void> {
    const stored = await getRuntimeOptions().credentialStore?.loadAll() ?? [];
    const now = new Date().toISOString();
    if (process.env.LETTER_BOX_PROCESS_ROLE !== 'worker') {
      await this.repository.resetConnectionStatuses(now);
    }
    for (const account of stored) {
      this.credentials.set(account.id, account);
      await this.repository.upsertStored(account, now);
    }
  }

  async list(userId: string | null = null): Promise<AccountStatus[]> {
    return (await this.repository.list(userId)).map(this.mapStatus);
  }

  async get(accountId: string, userId: string | null = null): Promise<AccountStatus> {
    const row = await this.repository.find(userId, accountId);
    if (!row) throw new NotFoundException('Аккаунт не найден');
    return this.mapStatus(row);
  }

  getConfig(accountId: string): AccountConfig {
    const account = this.credentials.get(accountId);
    if (!account) throw new NotFoundException('Credentials аккаунта не найдены');
    return account;
  }

  async reloadCredential(accountId: string): Promise<void> {
    const stored = await getRuntimeOptions().credentialStore?.loadAll() ?? [];
    const account = stored.find((candidate) => candidate.id === accountId);
    if (!account) {
      this.credentials.delete(accountId);
      throw new NotFoundException('Credentials аккаунта не найдены');
    }
    this.credentials.set(accountId, account);
  }

  prepare(input: SaveAccountInput, id: string = randomUUID()): AccountConfig {
    const email = input.email.trim().toLowerCase();
    const password = input.password.trim();
    if (!email || !password) throw new BadRequestException('Укажите email и пароль приложения');
    const server = input.provider === 'yandex'
      ? { host: 'imap.yandex.ru', port: 993, secure: true }
      : { host: 'imap.mail.ru', port: 993, secure: true };
    return { id, ...server, provider: input.provider, email, password };
  }

  use(account: AccountConfig): void {
    this.credentials.set(account.id, account);
  }

  async persist(account: AccountConfig, userId: string | null = null): Promise<void> {
    await getRuntimeOptions().credentialStore?.save(account);
    this.credentials.set(account.id, account);
    const now = new Date().toISOString();
    await this.repository.saveConnected(account, userId, now);
  }

  async setStatus(
    accountId: string,
    status: AccountStatus['status'],
    error: string | null = null,
  ): Promise<void> {
    await this.repository.setStatus(accountId, status, error, new Date().toISOString());
  }

  async markSynced(accountId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.repository.markSynced(accountId, now);
  }

  async remove(accountId: string, userId: string | null = null): Promise<void> {
    await this.get(accountId, userId);
    await getRuntimeOptions().credentialStore?.delete(accountId);
    this.credentials.delete(accountId);
    await this.repository.remove(userId, accountId);
  }

  async clearMailData(accountId: string): Promise<void> {
    await this.repository.clearMailData(accountId);
  }

  private mapStatus(row: AccountRow): AccountStatus {
    return {
      id: row.id, provider: row.provider, email: row.email, status: row.status,
      lastError: row.last_error, lastSyncAt: row.last_sync_at,
      unreadCount: row.unread_count,
    };
  }
}
