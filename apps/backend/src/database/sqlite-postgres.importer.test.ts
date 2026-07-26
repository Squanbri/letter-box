import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { configureRuntime } from '../runtime';
import { DatabaseService } from './database.service';
import { PostgresDatabaseService } from './postgres-database.service';
import { importSqliteToPostgres } from './sqlite-postgres.importer';

test('imports SQLite data idempotently into PostgreSQL', {
  skip: !process.env.POSTGRES_TEST_URL,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'letter-box-import-'));
  const sqlitePath = join(directory, 'source.db');
  const previousUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  configureRuntime({ databasePath: sqlitePath });
  const sqlite = new DatabaseService();
  sqlite.onModuleInit();
  const accountId = randomUUID();
  const now = new Date().toISOString();

  sqlite.db.prepare(`
    INSERT INTO accounts (
      id, provider, email, status, created_at, updated_at
    ) VALUES (?, 'mailru', ?, 'connected', ?, ?)
  `).run(accountId, `${accountId}@example.com`, now, now);
  sqlite.db.prepare(`
    INSERT INTO mailbox_state (account_id, mailbox, uid_validity)
    VALUES (?, 'INBOX', '10')
  `).run(accountId);
  sqlite.db.prepare(`
    INSERT INTO mailboxes (
      account_id, path, name, delimiter, special_use,
      total_count, unread_count, listed_at
    ) VALUES (?, 'INBOX', 'Inbox', '/', '\\Inbox', 1, 1, ?)
  `).run(accountId, now);
  sqlite.db.prepare(`
    INSERT INTO messages (
      account_id, mailbox, uid, subject, received_at, flags, size,
      body_text, body_loaded_at
    ) VALUES (?, 'INBOX', 42, 'Imported', ?, '["\\\\Seen"]', 100, 'Body', ?)
  `).run(accountId, now, now);
  sqlite.onModuleDestroy();

  process.env.DATABASE_URL = process.env.POSTGRES_TEST_URL;
  const postgres = new PostgresDatabaseService();
  await postgres.onModuleInit();
  try {
    const expected = {
      users: 0,
      authSessions: 0,
      accounts: 1,
      mailboxStates: 1,
      mailboxes: 1,
      messages: 1,
    };
    assert.deepEqual(await importSqliteToPostgres(sqlitePath, postgres), expected);
    assert.deepEqual(await importSqliteToPostgres(sqlitePath, postgres), expected);

    const result = await postgres.query<{
      count: number;
      subject: string;
      body_text: string;
    } & Record<string, unknown>>(
      `SELECT COUNT(*) OVER ()::int AS count, subject, body_text
       FROM messages WHERE account_id = $1 AND mailbox = 'INBOX' AND uid = 42`,
      [accountId],
    );
    assert.deepEqual(result.rows, [{
      count: 1,
      subject: 'Imported',
      body_text: 'Body',
    }]);
  } finally {
    await postgres.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    await postgres.onModuleDestroy();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
