import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AccountService } from '../account/account.service';
import { DatabaseService } from '../database/database.service';
import { configureRuntime, type AccountConfig } from '../runtime';
import { ImapService } from './imap.service';
import { MailService } from './mail.service';

const account = (id: string, email: string): AccountConfig => ({
  id,
  email,
  provider: 'mailru',
  password: 'secret',
  host: 'imap.mail.ru',
  port: 993,
  secure: true,
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'letter-box-mail-'));
  const deleted: string[] = [];
  configureRuntime({
    databasePath: join(directory, 'mail.db'),
    credentialStore: {
      loadAll: async () => [],
      save: async () => undefined,
      delete: async (id) => { deleted.push(id); },
    },
  });
  const database = new DatabaseService();
  database.onModuleInit();
  const accounts = new AccountService(database);
  await accounts.onModuleInit();
  return {
    accounts,
    database,
    deleted,
    close: () => {
      database.onModuleDestroy();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('isolates equal mailbox UIDs and cascades explicit account deletion', async () => {
  const context = await fixture();
  try {
    await context.accounts.persist(account('first', 'first@example.com'));
    await context.accounts.persist(account('second', 'second@example.com'));
    const insert = context.database.db.prepare(`
      INSERT INTO messages (
        account_id, mailbox, uid, received_at, flags, size
      ) VALUES (?, 'INBOX', 42, ?, '[]', 1)
    `);
    insert.run('first', new Date(0).toISOString());
    insert.run('second', new Date(0).toISOString());

    const count = context.database.db.prepare(
      'SELECT COUNT(*) AS count FROM messages',
    ).get() as { count: number };
    assert.equal(count.count, 2);
    await context.accounts.remove('first');
    assert.deepEqual(context.deleted, ['first']);
    assert.deepEqual(
      context.database.db.prepare('SELECT account_id FROM messages').all(),
      [{ account_id: 'second' }],
    );
  } finally {
    context.close();
  }
});

test('deduplicates concurrent synchronization for the same account', async () => {
  const context = await fixture();
  try {
    await context.accounts.persist(account('first', 'first@example.com'));
    let fetches = 0;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const imap = {
      fetchMetadata: async () => {
        fetches += 1;
        await waiting;
        return { uidValidity: '1', messages: [] };
      },
    } as unknown as ImapService;
    const mail = new MailService(context.database, imap, context.accounts);

    const first = mail.syncInbox('first');
    const second = mail.syncInbox('first');
    assert.strictEqual(first, second);
    assert.equal(context.accounts.get('first').status, 'syncing');
    release();
    assert.deepEqual(await Promise.all([first, second]), [{ synced: 0 }, { synced: 0 }]);
    assert.equal(fetches, 1);
    assert.equal(context.accounts.get('first').status, 'connected');
  } finally {
    context.close();
  }
});

test('resets an interrupted synchronization status after restart', async () => {
  const context = await fixture();
  try {
    await context.accounts.persist(account('first', 'first@example.com'));
    context.accounts.setStatus('first', 'syncing');

    const restartedAccounts = new AccountService(context.database);
    await restartedAccounts.onModuleInit();

    assert.equal(restartedAccounts.get('first').status, 'disconnected');
  } finally {
    context.close();
  }
});
