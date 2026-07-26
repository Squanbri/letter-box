import { Inject, Injectable } from '@nestjs/common';
import type { AccountStatus } from '@letter-box/contracts';
import { DatabaseService } from '../database/database.service';
import type { AccountConfig } from '../runtime';

export interface AccountRow {
  id: string;
  provider: 'mailru' | 'yandex';
  email: string;
  status: AccountStatus['status'];
  last_error: string | null;
  last_sync_at: string | null;
  unread_count: number;
}

@Injectable()
export class AccountRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async resetConnectionStatuses(now: string): Promise<void> {
    this.database.db.prepare(
      "UPDATE accounts SET status = 'disconnected', updated_at = ?",
    ).run(now);
  }

  async upsertStored(account: AccountConfig, now: string): Promise<void> {
    this.database.db.prepare(`
      INSERT INTO accounts (id, provider, email, status, created_at, updated_at)
      VALUES (?, ?, ?, 'disconnected', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider, email = excluded.email, updated_at = excluded.updated_at
    `).run(account.id, account.provider, account.email, now, now);
  }

  async list(userId: string | null): Promise<AccountRow[]> {
    return this.database.db.prepare(
      `${this.statusSelect()} WHERE user_id IS ? ORDER BY created_at`,
    ).all(userId) as AccountRow[];
  }

  async find(userId: string | null, accountId: string): Promise<AccountRow | undefined> {
    return this.database.db.prepare(
      `${this.statusSelect()} WHERE user_id IS ? AND id = ?`,
    ).get(userId, accountId) as AccountRow | undefined;
  }

  async saveConnected(
    account: AccountConfig,
    userId: string | null,
    now: string,
  ): Promise<void> {
    this.database.db.prepare(`
      INSERT INTO accounts (
        id, user_id, provider, email, status, last_error, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'connected', NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, email = excluded.email,
        user_id = excluded.user_id, status = 'connected', last_error = NULL,
        updated_at = excluded.updated_at
    `).run(account.id, userId, account.provider, account.email, now, now);
  }

  async setStatus(
    accountId: string,
    status: AccountStatus['status'],
    error: string | null,
    now: string,
  ): Promise<void> {
    this.database.db.prepare(
      'UPDATE accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?',
    ).run(status, error, now, accountId);
  }

  async markSynced(accountId: string, now: string): Promise<void> {
    this.database.db.prepare(
      "UPDATE accounts SET status = 'connected', last_error = NULL, last_sync_at = ?, updated_at = ? WHERE id = ?",
    ).run(now, now, accountId);
  }

  async remove(userId: string | null, accountId: string): Promise<void> {
    this.database.db.prepare(
      'DELETE FROM accounts WHERE user_id IS ? AND id = ?',
    ).run(userId, accountId);
  }

  async clearMailData(accountId: string): Promise<void> {
    this.database.clearAccountData(accountId);
  }

  private statusSelect(): string {
    return `SELECT id, provider, email, status, last_error, last_sync_at,
      (
        SELECT COUNT(*) FROM messages
        WHERE account_id = accounts.id AND mailbox = 'INBOX'
          AND NOT EXISTS (
            SELECT 1 FROM json_each(messages.flags) WHERE value = '\\Seen'
          )
      ) AS unread_count
    FROM accounts`;
  }
}
