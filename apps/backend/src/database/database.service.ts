import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getRuntimeOptions } from '../runtime';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private connection!: Database.Database;

  onModuleInit(): void {
    if (process.env.DATABASE_URL) return;
    const databasePath = resolve(
      getRuntimeOptions().databasePath
        ?? process.env.DATABASE_PATH
        ?? './data/letter-box.db',
    );
    mkdirSync(dirname(databasePath), { recursive: true });
    this.connection = new Database(databasePath);
    this.connection.pragma('journal_mode = WAL');
    this.migrateLegacyMailTables();
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'disconnected',
        last_error TEXT,
        last_sync_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mailbox_state (
        account_id TEXT NOT NULL,
        mailbox TEXT NOT NULL,
        uid_validity TEXT NOT NULL,
        PRIMARY KEY (account_id, mailbox),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS mailboxes (
        account_id TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        delimiter TEXT NOT NULL,
        special_use TEXT,
        total_count INTEGER NOT NULL DEFAULT 0,
        unread_count INTEGER NOT NULL DEFAULT 0,
        listed_at TEXT NOT NULL,
        PRIMARY KEY (account_id, path),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        account_id TEXT NOT NULL,
        mailbox TEXT NOT NULL,
        uid INTEGER NOT NULL,
        subject TEXT,
        sender_name TEXT,
        sender_address TEXT,
        received_at TEXT NOT NULL,
        flags TEXT NOT NULL,
        size INTEGER NOT NULL,
        body_text TEXT,
        body_html TEXT,
        body_loaded_at TEXT,
        PRIMARY KEY (account_id, mailbox, uid),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_received_at
      ON messages(account_id, mailbox, received_at DESC);
    `);
    this.ensureColumn('accounts', 'user_id', 'TEXT');
    this.ensureColumn('mailboxes', 'total_count', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('mailboxes', 'unread_count', 'INTEGER NOT NULL DEFAULT 0');
    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_accounts_user_created
      ON accounts(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
      ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
      ON auth_sessions(expires_at)
    `);
    this.connection.pragma('foreign_keys = ON');

    for (const path of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
      if (existsSync(path)) {
        chmodSync(path, 0o600);
      }
    }
  }

  onModuleDestroy(): void {
    this.connection?.close();
  }

  get db(): Database.Database {
    if (!this.connection) {
      throw new Error('SQLite adapter is disabled while DATABASE_URL is configured');
    }
    return this.connection;
  }

  clearAccountData(accountId: string): void {
    this.connection.transaction(() => {
      this.connection.prepare('DELETE FROM messages WHERE account_id = ?').run(accountId);
      this.connection.prepare('DELETE FROM mailbox_state WHERE account_id = ?').run(accountId);
    })();
  }

  private migrateLegacyMailTables(): void {
    const columns = (table: string) => this.connection
      .prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const messages = columns('messages');
    const mailboxState = columns('mailbox_state');
    if (messages.length > 0 && !messages.some((column) => column.name === 'account_id')) {
      this.connection.exec('DROP TABLE messages');
    }
    if (mailboxState.length > 0 && !mailboxState.some((column) => column.name === 'account_id')) {
      this.connection.exec('DROP TABLE mailbox_state');
    }
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.connection.prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
