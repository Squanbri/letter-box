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

    const first = mail.syncMailbox('first');
    const second = mail.syncMailbox('first');
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
      fetchChanges: async (
        _accountId: string,
        _mailbox: string,
        knownUids: number[],
      ) => {
        calls.push(knownUids);
        return snapshots.shift()!;
      },
    } as unknown as ImapService;
    const mail = new MailService(context.database, imap, context.accounts);

    assert.deepEqual(
      await mail.syncMailbox('first'),
      { synced: 2, added: 2, updated: 0, removed: 0 },
    );
    assert.deepEqual(
      await mail.syncMailbox('first'),
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

test('changes seen state only for the targeted account and mailbox', async () => {
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
    const updates: Array<{
      accountId: string;
      mailbox: string;
      uid: number;
      seen: boolean;
    }> = [];
    const imap = {
      setSeen: async (
        accountId: string,
        mailbox: string,
        uid: number,
        seen: boolean,
      ) => {
        updates.push({ accountId, mailbox, uid, seen });
      },
    } as unknown as ImapService;
    const mail = new MailService(context.database, imap, context.accounts);

    assert.equal(context.accounts.get('first').unreadCount, 1);
    assert.equal(context.accounts.get('second').unreadCount, 1);
    const updated = await mail.setSeen('first', 'INBOX', 42, true);

    assert.deepEqual(updates, [{
      accountId: 'first',
      mailbox: 'INBOX',
      uid: 42,
      seen: true,
    }]);
    assert.deepEqual(updated.flags, ['\\Seen']);
    assert.equal(context.accounts.get('first').unreadCount, 0);
    assert.equal(context.accounts.get('second').unreadCount, 1);
    assert.deepEqual(
      context.database.db.prepare(
        'SELECT account_id, flags FROM messages ORDER BY account_id',
      ).all(),
      [
        { account_id: 'first', flags: '["\\\\Seen"]' },
        { account_id: 'second', flags: '[]' },
      ],
    );
  } finally {
    context.close();
  }
});

test('caches the mailbox catalog and removes folders missing from IMAP', async () => {
  const context = await fixture();
  try {
    await context.accounts.persist(account('first', 'first@example.com'));
    const snapshots = [
      [
        {
          path: 'INBOX', name: 'INBOX', delimiter: '/', specialUse: '\\Inbox',
          totalCount: 20, unreadCount: 3,
        },
        {
          path: 'Archive', name: 'Archive', delimiter: '/', specialUse: '\\Archive',
          totalCount: 10, unreadCount: 0,
        },
      ],
      [{
        path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: '\\Inbox',
        totalCount: 21, unreadCount: 4,
      }],
    ];
    const imap = {
      fetchMailboxes: async () => snapshots.shift()!,
    } as unknown as ImapService;
    const mail = new MailService(context.database, imap, context.accounts);

    assert.equal((await mail.syncMailboxes('first')).length, 2);
    assert.deepEqual(await mail.syncMailboxes('first'), [{
      path: 'INBOX',
      name: 'Inbox',
      delimiter: '/',
      specialUse: '\\Inbox',
      totalCount: 21,
      unreadCount: 4,
    }]);
  } finally {
    context.close();
  }
});

test('stores equal UIDs independently in different mailboxes', async () => {
  const context = await fixture();
  try {
    await context.accounts.persist(account('first', 'first@example.com'));
    const requestedMailboxes: string[] = [];
    const imap = {
      fetchChanges: async (_accountId: string, mailbox: string) => {
        requestedMailboxes.push(mailbox);
        return {
          uidValidity: '1',
          reset: false,
          serverUids: [42],
          messages: [metadata(42, [])],
          flagUpdates: [],
        };
      },
    } as unknown as ImapService;
    const mail = new MailService(context.database, imap, context.accounts);

    await mail.syncMailbox('first', 'INBOX');
    await mail.syncMailbox('first', 'Archive');

    assert.deepEqual(requestedMailboxes, ['INBOX', 'Archive']);
    assert.deepEqual(
      context.database.db.prepare(
        'SELECT mailbox, uid FROM messages ORDER BY mailbox',
      ).all(),
      [{ mailbox: 'Archive', uid: 42 }, { mailbox: 'INBOX', uid: 42 }],
    );
  } finally {
    context.close();
  }
});

test('loads older message metadata in pages without replacing newer mail', async () => {
  const context = await fixture();
  try {
    await context.accounts.persist(account('first', 'first@example.com'));
    const imap = {
      fetchOlderMetadata: async (
        _accountId: string,
        mailbox: string,
        beforeUid: number | undefined,
        limit: number,
      ) => {
        assert.equal(mailbox, 'Archive');
        assert.equal(beforeUid, 100);
        assert.equal(limit, 50);
        return [metadata(98, []), metadata(99, [])];
      },
    } as unknown as ImapService;
    const mail = new MailService(context.database, imap, context.accounts);
    context.database.db.prepare(`
      INSERT INTO messages (
        account_id, mailbox, uid, received_at, flags, size
      ) VALUES ('first', 'Archive', 100, ?, '[]', 1)
    `).run(new Date(100_000).toISOString());

    assert.deepEqual(
      await mail.loadOlder('first', 'Archive', 100),
      { loaded: 2 },
    );
    assert.deepEqual(
      mail.listMessages('first', 'Archive', 2, 1).map((message) => message.uid),
      [99, 98],
    );
  } finally {
    context.close();
  }
});

test('synchronizes different mailboxes independently for one account', async () => {
  const context = await fixture();
  try {
    await context.accounts.persist(account('first', 'first@example.com'));
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const imap = {
      fetchChanges: async (_accountId: string, mailbox: string) => {
        started.push(mailbox);
        await new Promise<void>((resolve) => releases.set(mailbox, resolve));
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

    const inbox = mail.syncMailbox('first', 'INBOX');
    const archive = mail.syncMailbox('first', 'Archive');
    assert.deepEqual(started, ['INBOX', 'Archive']);
    releases.get('INBOX')!();
    releases.get('Archive')!();
    await Promise.all([inbox, archive]);
  } finally {
    context.close();
  }
});

test('flags, archives, and deletes only the targeted message', async () => {
  const context = await fixture();
  try {
    await context.accounts.persist(account('first', 'first@example.com'));
    const now = new Date().toISOString();
    const insertMailbox = context.database.db.prepare(`
      INSERT INTO mailboxes (
        account_id, path, name, delimiter, special_use, listed_at
      ) VALUES ('first', ?, ?, '/', ?, ?)
    `);
    insertMailbox.run('INBOX', 'Inbox', '\\Inbox', now);
    insertMailbox.run('Archive', 'Archive', '\\Archive', now);
    insertMailbox.run('Trash', 'Trash', '\\Trash', now);
    const insertMessage = context.database.db.prepare(`
      INSERT INTO messages (
        account_id, mailbox, uid, received_at, flags, size
      ) VALUES ('first', ?, ?, ?, '[]', 1)
    `);
    insertMessage.run('INBOX', 1, now);
    insertMessage.run('INBOX', 2, now);
    insertMessage.run('Trash', 3, now);
    const commands: string[] = [];
    const imap = {
      setFlagged: async (_id: string, mailbox: string, uid: number, value: boolean) => {
        commands.push(`flag:${mailbox}:${uid}:${value}`);
      },
      moveMessage: async (
        _id: string,
        mailbox: string,
        uid: number,
        destination: string,
      ) => {
        commands.push(`move:${mailbox}:${uid}:${destination}`);
      },
      deleteMessage: async (_id: string, mailbox: string, uid: number) => {
        commands.push(`delete:${mailbox}:${uid}`);
      },
    } as unknown as ImapService;
    const mail = new MailService(context.database, imap, context.accounts);

    assert.deepEqual((await mail.setFlagged('first', 'INBOX', 1, true)).flags, ['\\Flagged']);
    await mail.archiveMessage('first', 'INBOX', 1);
    await mail.deleteMessage('first', 'INBOX', 2);
    await mail.deleteMessage('first', 'Trash', 3);

    assert.deepEqual(commands, [
      'flag:INBOX:1:true',
      'move:INBOX:1:Archive',
      'move:INBOX:2:Trash',
      'delete:Trash:3',
    ]);
    assert.equal(
      (context.database.db.prepare(
        'SELECT COUNT(*) AS count FROM messages WHERE account_id = ?',
      ).get('first') as { count: number }).count,
      0,
    );
  } finally {
    context.close();
  }
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
