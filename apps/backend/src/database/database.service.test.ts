import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { configureRuntime } from '../runtime';
import { DatabaseService } from './database.service';

test('migrates the legacy single-account mail schema to composite keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'letter-box-migration-'));
  const databasePath = join(directory, 'mail.db');
  const legacy = new Database(databasePath);
  legacy.exec(`
    CREATE TABLE mailbox_state (mailbox TEXT PRIMARY KEY, uid_validity TEXT NOT NULL);
    CREATE TABLE messages (
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
  `);
  legacy.close();

  configureRuntime({ databasePath });
  const database = new DatabaseService();
  try {
    database.onModuleInit();
    const messageColumns = database.db.prepare(
      'PRAGMA table_info(messages)',
    ).all() as Array<{ name: string; pk: number }>;
    const mailboxColumns = database.db.prepare(
      'PRAGMA table_info(mailbox_state)',
    ).all() as Array<{ name: string; pk: number }>;

    assert.deepEqual(
      messageColumns.filter((column) => column.pk > 0).map((column) => column.name),
      ['account_id', 'mailbox', 'uid'],
    );
    assert.deepEqual(
      mailboxColumns.filter((column) => column.pk > 0).map((column) => column.name),
      ['account_id', 'mailbox'],
    );
  } finally {
    database.onModuleDestroy();
    rmSync(directory, { recursive: true, force: true });
  }
});
