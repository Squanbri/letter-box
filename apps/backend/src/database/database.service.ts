import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private connection!: Database.Database;

  onModuleInit(): void {
    const databasePath = resolve(process.env.DATABASE_PATH ?? './data/letter-box.db');
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
  }

  onModuleDestroy(): void {
    this.connection?.close();
  }

  get db(): Database.Database {
    return this.connection;
  }
}

