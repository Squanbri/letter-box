import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { AccountConfig, getRuntimeOptions } from '../runtime';

export interface SaveAccountInput {
  provider: 'mailru' | 'yandex';
  email: string;
  password: string;
}

export interface AccountStatus {
  id: string;
  provider: 'mailru' | 'yandex';
  email: string;
  status: 'connected' | 'disconnected' | 'error';
  lastError: string | null;
  lastSyncAt: string | null;
}

interface AccountRow {
  id: string;
  provider: 'mailru' | 'yandex';
  email: string;
  status: AccountStatus['status'];
  last_error: string | null;
  last_sync_at: string | null;
}

@Injectable()
export class AccountService implements OnModuleInit {
  private readonly credentials = new Map<string, AccountConfig>();

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    const stored = await getRuntimeOptions().credentialStore?.loadAll() ?? [];
    const now = new Date().toISOString();
    const upsert = this.database.db.prepare(`
      INSERT INTO accounts (id, provider, email, status, created_at, updated_at)
      VALUES (?, ?, ?, 'disconnected', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider, email = excluded.email, updated_at = excluded.updated_at
    `);
    for (const account of stored) {
      this.credentials.set(account.id, account);
      upsert.run(account.id, account.provider, account.email, now, now);
    }
  }

  list(): AccountStatus[] {
    const rows = this.database.db.prepare(
      'SELECT id, provider, email, status, last_error, last_sync_at FROM accounts ORDER BY created_at',
    ).all() as AccountRow[];
    return rows.map(this.mapStatus);
  }

  get(accountId: string): AccountStatus {
    const row = this.database.db.prepare(
      'SELECT id, provider, email, status, last_error, last_sync_at FROM accounts WHERE id = ?',
    ).get(accountId) as AccountRow | undefined;
    if (!row) throw new NotFoundException('Аккаунт не найден');
    return this.mapStatus(row);
  }

  getConfig(accountId: string): AccountConfig {
    const account = this.credentials.get(accountId);
    if (!account) throw new NotFoundException('Credentials аккаунта не найдены');
    return account;
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

  async persist(account: AccountConfig): Promise<void> {
    await getRuntimeOptions().credentialStore?.save(account);
    this.credentials.set(account.id, account);
    const now = new Date().toISOString();
    this.database.db.prepare(`
      INSERT INTO accounts (id, provider, email, status, last_error, created_at, updated_at)
      VALUES (?, ?, ?, 'connected', NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, email = excluded.email,
        status = 'connected', last_error = NULL, updated_at = excluded.updated_at
    `).run(account.id, account.provider, account.email, now, now);
  }

  setStatus(accountId: string, status: AccountStatus['status'], error: string | null = null): void {
    this.database.db.prepare(
      'UPDATE accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?',
    ).run(status, error, new Date().toISOString(), accountId);
  }

  markSynced(accountId: string): void {
    const now = new Date().toISOString();
    this.database.db.prepare(
      "UPDATE accounts SET status = 'connected', last_error = NULL, last_sync_at = ?, updated_at = ? WHERE id = ?",
    ).run(now, now, accountId);
  }

  async remove(accountId: string): Promise<void> {
    this.get(accountId);
    await getRuntimeOptions().credentialStore?.delete(accountId);
    this.credentials.delete(accountId);
    this.database.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  }

  private mapStatus(row: AccountRow): AccountStatus {
    return {
      id: row.id, provider: row.provider, email: row.email, status: row.status,
      lastError: row.last_error, lastSyncAt: row.last_sync_at,
    };
  }
}
