import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AccountService } from '../account/account.service';
import { DatabaseService } from '../database/database.service';
import { configureRuntime, type AccountConfig } from '../runtime';
import { ImapService, selectMetadataUids } from './imap.service';
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
      fetchChanges: async () => {
        fetches += 1;
        await waiting;
        return {
          uidValidity: '1',
          reset: false,
          serverUids: [],
          messages: [],
          flagUpdates: [],
        };
      },
    } as unknown as ImapService;
    const mail = new MailService(context.database, imap, context.accounts);

    const first = mail.syncInbox('first');
    const second = mail.syncInbox('first');
    assert.strictEqual(first, second);
    assert.equal(context.accounts.get('first').status, 'syncing');
    release();
    const emptyResult = { synced: 0, added: 0, updated: 0, removed: 0 };
    assert.deepEqual(await Promise.all([first, second]), [emptyResult, emptyResult]);
    assert.equal(fetches, 1);
    assert.equal(context.accounts.get('first').status, 'connected');
  } finally {
    context.close();
  }
});

test('applies incremental additions, flag updates, and removals', async () => {
  const context = await fixture();
  try {
    await context.accounts.persist(account('first', 'first@example.com'));
    const snapshots = [
      {
        uidValidity: '1',
        reset: false,
        serverUids: [10, 11],
        messages: [
          metadata(10, []),
          metadata(11, ['\\Seen']),
        ],
        flagUpdates: [],
      },
      {
        uidValidity: '1',
        reset: false,
        serverUids: [11, 12],
        messages: [metadata(12, [])],
        flagUpdates: [{ uid: 11, flags: [] }],
      },
    ];
    const calls: number[][] = [];
    const imap = {
      fetchChanges: async (_accountId: string, knownUids: number[]) => {
        calls.push(knownUids);
        return snapshots.shift()!;
      },
    } as unknown as ImapService;
    const mail = new MailService(context.database, imap, context.accounts);

    assert.deepEqual(
      await mail.syncInbox('first'),
      { synced: 2, added: 2, updated: 0, removed: 0 },
    );
    assert.deepEqual(
      await mail.syncInbox('first'),
      { synced: 2, added: 1, updated: 1, removed: 1 },
    );
    assert.deepEqual(calls, [[], [10, 11]]);
    assert.deepEqual(
      context.database.db.prepare(
        'SELECT uid, flags FROM messages ORDER BY uid',
      ).all(),
      [{ uid: 11, flags: '[]' }, { uid: 12, flags: '[]' }],
    );
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

test('limits initial metadata and never backfills older UIDs as new mail', () => {
  const serverUids = Array.from({ length: 1_000 }, (_, index) => index + 1);
  assert.deepEqual(
    selectMetadataUids(serverUids, [], 3),
    [998, 999, 1000],
  );
  assert.deepEqual(
    selectMetadataUids([...serverUids, 1001, 1002], [998, 999, 1000], 500),
    [1001, 1002],
  );
});

function metadata(uid: number, flags: string[]) {
  return {
    uid,
    subject: `Message ${uid}`,
    senderName: null,
    senderAddress: 'sender@example.com',
    date: new Date(uid * 1000).toISOString(),
    flags,
    size: uid,
  };
}
