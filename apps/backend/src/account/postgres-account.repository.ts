import { Inject, Injectable } from '@nestjs/common';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import type { AccountConfig } from '../runtime';
import type { AccountStatus } from '@letter-box/contracts';
import type { AccountRow } from './account.repository';
import type { QueryResultRow } from 'pg';

interface PostgresAccountRow extends AccountRow, QueryResultRow {}

@Injectable()
export class PostgresAccountRepository {
  constructor(
    @Inject(PostgresDatabaseService)
    private readonly database: PostgresDatabaseService,
  ) {}

  async resetConnectionStatuses(now: string): Promise<void> {
    await this.database.query(
      "UPDATE accounts SET status = 'disconnected', updated_at = $1",
      [now],
    );
  }

  async upsertStored(account: AccountConfig, now: string): Promise<void> {
    await this.database.query(`
      INSERT INTO accounts (id, provider, email, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'disconnected', $4, $4)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        email = excluded.email,
        updated_at = excluded.updated_at
    `, [account.id, account.provider, account.email, now]);
  }

  async list(userId: string | null): Promise<AccountRow[]> {
    const result = await this.database.query<PostgresAccountRow>(
      `${this.statusSelect()} WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY created_at`,
      [userId],
    );
    return result.rows;
  }

  async find(userId: string | null, accountId: string): Promise<AccountRow | undefined> {
    const result = await this.database.query<PostgresAccountRow>(
      `${this.statusSelect()} WHERE user_id IS NOT DISTINCT FROM $1 AND id = $2`,
      [userId, accountId],
    );
    return result.rows[0];
  }

  async saveConnected(
    account: AccountConfig,
    userId: string | null,
    now: string,
  ): Promise<void> {
    await this.database.query(`
      INSERT INTO accounts (
        id, user_id, provider, email, status, last_error, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, 'connected', NULL, $5, $5)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        provider = excluded.provider,
        email = excluded.email,
        status = 'connected',
        last_error = NULL,
        updated_at = excluded.updated_at
    `, [account.id, userId, account.provider, account.email, now]);
  }

  async setStatus(
    accountId: string,
    status: AccountStatus['status'],
    error: string | null,
    now: string,
  ): Promise<void> {
    await this.database.query(
      `UPDATE accounts
       SET status = $1, last_error = $2, updated_at = $3
       WHERE id = $4`,
      [status, error, now, accountId],
    );
  }

  async markSynced(accountId: string, now: string): Promise<void> {
    await this.database.query(
      `UPDATE accounts
       SET status = 'connected', last_error = NULL,
           last_sync_at = $1, updated_at = $1
       WHERE id = $2`,
      [now, accountId],
    );
  }

  async remove(userId: string | null, accountId: string): Promise<void> {
    await this.database.query(
      'DELETE FROM accounts WHERE user_id IS NOT DISTINCT FROM $1 AND id = $2',
      [userId, accountId],
    );
  }

  async clearMailData(accountId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query('DELETE FROM messages WHERE account_id = $1', [accountId]);
      await client.query('DELETE FROM mailbox_state WHERE account_id = $1', [accountId]);
    });
  }

  private statusSelect(): string {
    return `SELECT id, provider, email, status, last_error,
      last_sync_at::text AS last_sync_at,
      (
        SELECT COUNT(*)::int FROM messages
        WHERE account_id = accounts.id
          AND mailbox = 'INBOX'
          AND NOT (messages.flags ? '\\Seen')
      ) AS unread_count
    FROM accounts`;
  }
}
