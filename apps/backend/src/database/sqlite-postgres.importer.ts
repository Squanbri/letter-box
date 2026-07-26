import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { PostgresDatabaseService } from './postgres-database.service';

export interface ImportResult {
  users: number;
  authSessions: number;
  accounts: number;
  mailboxStates: number;
  mailboxes: number;
  messages: number;
}

interface SqliteRow {
  [key: string]: unknown;
}

export async function importSqliteToPostgres(
  sqlitePath: string,
  postgres: PostgresDatabaseService,
): Promise<ImportResult> {
  const sourcePath = resolve(sqlitePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`SQLite source does not exist: ${sourcePath}`);
  }

  const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    for (const table of ['accounts', 'mailbox_state', 'mailboxes', 'messages']) {
      const found = sqlite.prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
      ).get(table);
      if (!found) throw new Error(`SQLite source is missing table: ${table}`);
    }

    const rows = {
      users: hasTable(sqlite, 'users')
        ? sqlite.prepare('SELECT * FROM users ORDER BY created_at').all() as SqliteRow[]
        : [],
      authSessions: hasTable(sqlite, 'auth_sessions')
        ? sqlite.prepare('SELECT * FROM auth_sessions').all() as SqliteRow[]
        : [],
      accounts: sqlite.prepare('SELECT * FROM accounts ORDER BY created_at').all() as SqliteRow[],
      mailboxStates: sqlite.prepare('SELECT * FROM mailbox_state').all() as SqliteRow[],
      mailboxes: sqlite.prepare('SELECT * FROM mailboxes').all() as SqliteRow[],
      messages: sqlite.prepare('SELECT * FROM messages').all() as SqliteRow[],
    };

    await postgres.transaction(async (client) => {
      await client.query(`
        LOCK TABLE users, auth_sessions, accounts, mailbox_state, mailboxes, messages
        IN SHARE ROW EXCLUSIVE MODE
      `);
      for (const row of rows.users) await upsertUser(client, row);
      for (const row of rows.authSessions) await upsertAuthSession(client, row);
      for (const row of rows.accounts) await upsertAccount(client, row);
      for (const row of rows.mailboxStates) await upsertMailboxState(client, row);
      for (const row of rows.mailboxes) await upsertMailbox(client, row);
      for (const row of rows.messages) await upsertMessage(client, row);
    });

    return {
      users: rows.users.length,
      authSessions: rows.authSessions.length,
      accounts: rows.accounts.length,
      mailboxStates: rows.mailboxStates.length,
      mailboxes: rows.mailboxes.length,
      messages: rows.messages.length,
    };
  } finally {
    sqlite.close();
  }
}

async function upsertAuthSession(client: PoolClient, row: SqliteRow): Promise<void> {
  await client.query(`
    INSERT INTO auth_sessions (
      id, user_id, token_hash, expires_at, created_at
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `, [row.id, row.user_id, row.token_hash, row.expires_at, row.created_at]);
}

async function upsertUser(client: PoolClient, row: SqliteRow): Promise<void> {
  await client.query(`
    INSERT INTO users (id, email, password_hash, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      password_hash = excluded.password_hash,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `, [row.id, row.email, row.password_hash, row.created_at, row.updated_at]);
}

async function upsertAccount(client: PoolClient, row: SqliteRow): Promise<void> {
  await client.query(`
    INSERT INTO accounts (
      id, user_id, provider, email, status, last_error,
      last_sync_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'disconnected', $5, $6, $7, $8)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      provider = excluded.provider,
      email = excluded.email,
      status = 'disconnected',
      last_error = excluded.last_error,
      last_sync_at = excluded.last_sync_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `, [
    row.id, row.user_id ?? null, row.provider, row.email, row.last_error,
    row.last_sync_at, row.created_at, row.updated_at,
  ]);
}

async function upsertMailboxState(client: PoolClient, row: SqliteRow): Promise<void> {
  await client.query(`
    INSERT INTO mailbox_state (account_id, mailbox, uid_validity)
    VALUES ($1, $2, $3)
    ON CONFLICT(account_id, mailbox) DO UPDATE
    SET uid_validity = excluded.uid_validity
  `, [row.account_id, row.mailbox, row.uid_validity]);
}

async function upsertMailbox(client: PoolClient, row: SqliteRow): Promise<void> {
  await client.query(`
    INSERT INTO mailboxes (
      account_id, path, name, delimiter, special_use,
      total_count, unread_count, listed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT(account_id, path) DO UPDATE SET
      name = excluded.name,
      delimiter = excluded.delimiter,
      special_use = excluded.special_use,
      total_count = excluded.total_count,
      unread_count = excluded.unread_count,
      listed_at = excluded.listed_at
  `, [
    row.account_id, row.path, row.name, row.delimiter, row.special_use,
    row.total_count, row.unread_count, row.listed_at,
  ]);
}

async function upsertMessage(client: PoolClient, row: SqliteRow): Promise<void> {
  await client.query(`
    INSERT INTO messages (
      account_id, mailbox, uid, subject, sender_name, sender_address,
      received_at, flags, size, body_text, body_html, body_loaded_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12
    )
    ON CONFLICT(account_id, mailbox, uid) DO UPDATE SET
      subject = excluded.subject,
      sender_name = excluded.sender_name,
      sender_address = excluded.sender_address,
      received_at = excluded.received_at,
      flags = excluded.flags,
      size = excluded.size,
      body_text = excluded.body_text,
      body_html = excluded.body_html,
      body_loaded_at = excluded.body_loaded_at
  `, [
    row.account_id, row.mailbox, row.uid, row.subject, row.sender_name,
    row.sender_address, row.received_at, normalizeFlags(row.flags), row.size,
    row.body_text, row.body_html, row.body_loaded_at,
  ]);
}

function normalizeFlags(value: unknown): string {
  if (typeof value !== 'string') return '[]';
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((flag) => typeof flag === 'string')) {
    throw new Error('Invalid message flags in SQLite source');
  }
  return JSON.stringify(parsed);
}

function hasTable(sqlite: Database.Database, table: string): boolean {
  return Boolean(sqlite.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(table));
}
