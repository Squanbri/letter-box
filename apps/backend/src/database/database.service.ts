import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getRuntimeOptions } from '../runtime';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private connection!: Database.Database;

  onModuleInit(): void {
    const databasePath = resolve(
      getRuntimeOptions().databasePath
        ?? process.env.DATABASE_PATH
        ?? './data/letter-box.db',
    );
    mkdirSync(dirname(databasePath), { recursive: true });
    this.connection = new Database(databasePath);
    this.connection.pragma('journal_mode = WAL');
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS mailbox_state (
        mailbox TEXT PRIMARY KEY,
        uid_validity TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        uid INTEGER PRIMARY KEY,
        subject TEXT,
        sender_name TEXT,
        sender_address TEXT,
        received_at TEXT NOT NULL,
        flags TEXT NOT NULL,
        size INTEGER NOT NULL,
        body_text TEXT,
        body_html TEXT,
        body_loaded_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_received_at
      ON messages(received_at DESC);
    `);

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
    return this.connection;
  }

  clearMailData(): void {
    this.connection.transaction(() => {
      this.connection.prepare('DELETE FROM messages').run();
      this.connection.prepare('DELETE FROM mailbox_state').run();
    })();
  }
}
