import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountStatus } from '@letter-box/contracts';
import { AccountService } from '../account/account.service';
import type { MailRepositoryContract } from '../database/repository.contracts';
import { ImapService, selectBackfillUids, selectMetadataUids } from './imap.service';
import { isConnectionOrAuthError, MailService } from './mail.service';
import { SmtpService } from './smtp.service';
import type { MailboxChanges, MailboxRecord, MessageRow } from './mail.types';

function accountsMock(status: AccountStatus['status'] = 'connected'): AccountService {
  const state = { status };
  return {
    get: async () => ({
      id: 'first',
      email: 'first@example.com',
      provider: 'mailru',
      status: state.status,
      lastError: null,
      lastSyncAt: null,
      unreadCount: 0,
    }),
    setStatus: async (_id: string, next: AccountStatus['status']) => {
      state.status = next;
    },
    markSynced: async () => {
      state.status = 'connected';
    },
    recordSyncFailure: async (_id: string, _error: string) => {
      state.status = 'error';
    },
    isSyncBackoffActive: async () => false,
    getSyncBackoffRemainingMs: async () => 0,
  } as unknown as AccountService;
}

function smtpMock(overrides: Partial<SmtpService> = {}): SmtpService {
  return {
    send: async () => ({
      messageId: '<test@letter-box>',
      accepted: ['to@example.com'],
      rejected: [],
      raw: Buffer.from('raw'),
    }),
    ...overrides,
  } as unknown as SmtpService;
}

function repositoryMock(
  overrides: Partial<MailRepositoryContract> = {},
): MailRepositoryContract {
  return {
    mailboxState: async () => undefined,
    knownUids: async () => [],
    folderCursor: async () => undefined,
    setFolderCursor: async () => undefined,
    applyChanges: async () => 0,
    listMessages: async () => [],
    listInbox: async () => [],
    listMailboxes: async () => [],
    replaceMailboxes: async () => undefined,
    saveMessages: async () => undefined,
    findMessage: async () => undefined,
    listThread: async () => [],
    classificationCandidateUids: async () => [],
    saveClassificationPreparations: async () => undefined,
    saveBody: async () => undefined,
    saveFlags: async () => undefined,
    hasMailbox: async () => true,
    specialMailbox: async () => undefined,
    removeMessage: async () => undefined,
    tagCounts: async () => [],
    messagesByDay: async () => [],
    messagesByTag: async () => [],
    messagesByTagByAccount: async () => [],
    awaitingReply: async () => [],
    messageTotals: async () => ({ total: 0, classified: 0, pending: 0, failed: 0 }),
    ...overrides,
  };
}

function emptyChanges(): MailboxChanges {
  return {
    uidValidity: '1',
    reset: false,
    serverUids: [],
    messages: [],
    flagUpdates: [],
    classificationPreparations: [],
  };
}

function row(partial: Partial<MessageRow> & Pick<MessageRow, 'uid' | 'mailbox'>): MessageRow {
  return {
    account_id: 'first',
    subject: null,
    sender_name: null,
    sender_address: null,
    received_at: new Date(0).toISOString(),
    flags: '[]',
    size: 1,
    body_text: null,
    body_html: null,
    body_loaded_at: null,
    classification_text: null,
    classification_status: 'pending',
    classified_at: null,
    tags: [],
    message_id: null,
    in_reply_to: null,
    references_header: null,
    thread_id: null,
    ...partial,
  };
}

test('deduplicates concurrent synchronization for the same account', async () => {
  let fetches = 0;
  let release!: () => void;
  let markStarted!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const accounts = accountsMock();
  const imap = {
    fetchChanges: async () => {
      fetches += 1;
      markStarted();
      await waiting;
      return emptyChanges();
    },
  } as unknown as ImapService;
  const mail = new MailService(repositoryMock(), imap, smtpMock(), accounts);

  const first = mail.syncMailbox('first');
  const second = mail.syncMailbox('first');
  assert.strictEqual(first, second);
  await started;
  release();
  const emptyResult = { synced: 0, added: 0, updated: 0, removed: 0, uidValidityReset: false };
  assert.deepEqual(await Promise.all([first, second]), [emptyResult, emptyResult]);
  assert.equal(fetches, 1);
});

test('synchronizes different mailboxes independently for one account', async () => {
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  let markBothStarted!: () => void;
  const bothStarted = new Promise<void>((resolve) => { markBothStarted = resolve; });
  const imap = {
    fetchChanges: async (_accountId: string, mailbox: string) => {
      started.push(mailbox);
      if (started.length === 2) markBothStarted();
      await new Promise<void>((resolve) => releases.set(mailbox, resolve));
      return emptyChanges();
    },
  } as unknown as ImapService;
  const mail = new MailService(repositoryMock(), imap, smtpMock(), accountsMock());

  const inbox = mail.syncMailbox('first', 'INBOX');
  const archive = mail.syncMailbox('first', 'Archive');
  await bothStarted;
  assert.deepEqual(started, ['INBOX', 'Archive']);
  releases.get('INBOX')!();
  releases.get('Archive')!();
  await Promise.all([inbox, archive]);
});

test('passes classification candidates and applies incremental sync results', async () => {
  const knownCalls: number[][] = [];
  const candidateCalls: number[][] = [];
  const applyCalls: MailboxChanges[] = [];
  let known = [] as number[];
  let candidates = [1];
  const snapshots = [
    {
      ...emptyChanges(),
      serverUids: [1, 2, 3],
      messages: [{
        uid: 3,
        subject: 'New',
        senderName: null,
        senderAddress: 'a@b.c',
        date: new Date(3_000).toISOString(),
        flags: ['\\Seen'],
        size: 3,
        messageId: '<new@example.com>',
        inReplyTo: null,
        references: [],
        threadId: '<new@example.com>',
      }],
      classificationPreparations: [
        { uid: 1, text: 'Existing unread', status: 'pending' as const },
        { uid: 3, text: 'New message', status: 'pending' as const },
      ],
    },
    emptyChanges(),
  ];
  const repository = repositoryMock({
    knownUids: async () => {
      knownCalls.push([...known]);
      return known;
    },
    classificationCandidateUids: async () => {
      candidateCalls.push([...candidates]);
      return candidates;
    },
    applyChanges: async (_accountId, _mailbox, changes) => {
      applyCalls.push(changes);
      known = [...changes.serverUids];
      candidates = [];
      return changes.reset ? 0 : 1;
    },
  });
  const imap = {
    fetchChanges: async (
      _accountId: string,
      _mailbox: string,
      knownUids: number[],
      _uidValidity: string | undefined,
      classificationCandidateUids: number[],
    ) => {
      assert.deepEqual(knownUids, knownCalls.at(-1));
      assert.deepEqual(classificationCandidateUids, candidateCalls.at(-1));
      return snapshots.shift()!;
    },
  } as unknown as ImapService;
  const mail = new MailService(repository, imap, smtpMock(), accountsMock());

  assert.deepEqual(
    await mail.syncMailbox('first'),
    { synced: 1, added: 1, updated: 0, removed: 1, uidValidityReset: false },
  );
  assert.deepEqual(
    await mail.syncMailbox('first'),
    { synced: 0, added: 0, updated: 0, removed: 1, uidValidityReset: false },
  );
  assert.deepEqual(candidateCalls, [[1], []]);
  assert.equal(applyCalls[0]?.classificationPreparations.length, 2);
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

test('selectBackfillUids walks newest-to-oldest below the cursor', () => {
  const serverUids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(selectBackfillUids(serverUids, 8, 3), [5, 6, 7]);
  assert.deepEqual(selectBackfillUids(serverUids, 5, 10), [1, 2, 3, 4]);
  assert.deepEqual(selectBackfillUids(serverUids, 1, 10), []);
  assert.deepEqual(selectBackfillUids(serverUids, undefined, 3), [8, 9, 10]);
});

test('backfill resumes from backfilledUid and marks folder complete', async () => {
  process.env.BACKFILL_BATCH_DELAY_MS = '0';
  process.env.BACKFILL_BATCH_SIZE = '200';

  let backfilledUid: number | null = 8;
  const known = [8, 9, 10];
  const saved: number[][] = [];
  const fetches: Array<number | undefined> = [];

  const repository = repositoryMock({
    folderCursor: async () => ({
      uidValidity: '1',
      lastSeenUid: 10,
      backfilledUid,
    }),
    knownUids: async () => known,
    setFolderCursor: async (_accountId, _mailbox, cursor) => {
      if (cursor.backfilledUid !== undefined) {
        backfilledUid = cursor.backfilledUid;
      }
    },
    saveMessages: async (_accountId, _mailbox, messages) => {
      saved.push(messages.map((message) => message.uid));
      known.push(...messages.map((message) => message.uid));
    },
  });

  const imap = {
    fetchOlderMetadata: async (
      _accountId: string,
      _mailbox: string,
      beforeUid: number | undefined,
      limit: number,
    ) => {
      fetches.push(beforeUid);
      const page = selectBackfillUids(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        beforeUid,
        limit,
      );
      return page.map((uid) => ({
        uid,
        subject: `m-${uid}`,
        senderName: null,
        senderAddress: 'a@b.c',
        date: new Date(uid * 1_000).toISOString(),
        flags: [],
        size: uid,
        messageId: `<${uid}@example.com>`,
        inReplyTo: null,
        references: [],
        threadId: `<${uid}@example.com>`,
      }));
    },
  } as unknown as ImapService;

  const mail = new MailService(repository, imap, smtpMock(), accountsMock());
  const result = await mail.backfillMailbox('first', 'INBOX');

  assert.equal(result.done, true);
  assert.equal(result.backfilledUid, 0);
  assert.deepEqual(fetches[0], 8);
  assert.ok(saved.length >= 1);
  assert.equal(Math.min(...saved.flat()), 1);
  assert.equal(backfilledUid, 0);
});

test('backfill no-ops when folder history is already complete', async () => {
  const fetches: number[] = [];
  const repository = repositoryMock({
    folderCursor: async () => ({
      uidValidity: '1',
      lastSeenUid: 10,
      backfilledUid: 0,
    }),
  });
  const imap = {
    fetchOlderMetadata: async () => {
      fetches.push(1);
      return [];
    },
  } as unknown as ImapService;
  const mail = new MailService(repository, imap, smtpMock(), accountsMock());
  const result = await mail.backfillMailbox('first', 'INBOX');
  assert.deepEqual(result, { done: true, loaded: 0, backfilledUid: 0 });
  assert.deepEqual(fetches, []);
});

test('detects connection and auth errors for sync backoff', () => {
  assert.equal(isConnectionOrAuthError('IMAP authentication failed'), true);
  assert.equal(isConnectionOrAuthError('connect ETIMEDOUT'), true);
  assert.equal(isConnectionOrAuthError('oauth token expired'), true);
  assert.equal(isConnectionOrAuthError('parse error in envelope'), false);
});

test('marks uidValidityReset when IMAP UIDVALIDITY changes', async () => {
  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const repository = repositoryMock({
      folderCursor: async () => ({
        uidValidity: '111',
        lastSeenUid: 10,
        backfilledUid: 0,
      }),
      mailboxState: async () => '111',
      applyChanges: async (_accountId, _mailbox, changes) => {
        assert.equal(changes.reset, true);
        return 3;
      },
    });
    const imap = {
      fetchChanges: async () => ({
        uidValidity: '222',
        reset: true,
        serverUids: [1],
        messages: [],
        flagUpdates: [],
        classificationPreparations: [],
      }),
    } as unknown as ImapService;
    const mail = new MailService(repository, imap, smtpMock(), accountsMock());
    const result = await mail.syncMailbox('first', 'INBOX');
    assert.equal(result.uidValidityReset, true);
    assert.ok(
      warnings.some((entry) =>
        Array.isArray(entry) && String(entry[0]).includes('[sync:uidvalidity]'),
      ),
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('flags, archives, and deletes only the targeted message', async () => {
  const commands: string[] = [];
  const rows = new Map<string, MessageRow>([
    ['INBOX:1', row({ mailbox: 'INBOX', uid: 1 })],
    ['INBOX:2', row({ mailbox: 'INBOX', uid: 2 })],
    ['Trash:3', row({ mailbox: 'Trash', uid: 3 })],
  ]);
  const repository = repositoryMock({
    findMessage: async (_accountId, mailbox, uid) => rows.get(`${mailbox}:${uid}`),
    saveFlags: async (_accountId, mailbox, uid, flags) => {
      const current = rows.get(`${mailbox}:${uid}`);
      if (current) rows.set(`${mailbox}:${uid}`, { ...current, flags: JSON.stringify(flags) });
    },
    specialMailbox: async (_accountId, specialUse) => {
      if (specialUse === '\\Archive') return 'Archive';
      if (specialUse === '\\Trash') return 'Trash';
      return undefined;
    },
    hasMailbox: async (_accountId, mailbox) => ['INBOX', 'Archive', 'Trash'].includes(mailbox),
    removeMessage: async (_accountId, mailbox, uid) => {
      rows.delete(`${mailbox}:${uid}`);
    },
  });
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
  const mail = new MailService(repository, imap, smtpMock(), accountsMock());

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
  assert.equal(rows.size, 0);
});

test('caches the mailbox catalog from IMAP replacements', async () => {
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
  let stored: MailboxRecord[] = snapshots[0]!;
  const repository = repositoryMock({
    replaceMailboxes: async (_accountId, mailboxes) => {
      stored = mailboxes;
    },
    listMailboxes: async () => stored,
  });
  const imap = {
    fetchMailboxes: async () => snapshots.shift()!,
  } as unknown as ImapService;
  const mail = new MailService(repository, imap, smtpMock(), accountsMock());

  assert.equal((await mail.syncMailboxes('first')).length, 2);
  assert.deepEqual(await mail.syncMailboxes('first'), [{
    path: 'INBOX',
    name: 'Inbox',
    delimiter: '/',
    specialUse: '\\Inbox',
    totalCount: 21,
    unreadCount: 4,
  }]);
});

test('sends a message over SMTP and appends a copy to Sent', async () => {
  const calls: string[] = [];
  const repository = repositoryMock({
    specialMailbox: async (_accountId, specialUse) =>
      specialUse === '\\Sent' ? 'Sent' : undefined,
  });
  const imap = {
    appendMessage: async (
      accountId: string,
      mailbox: string,
      source: Buffer,
      flags: string[],
    ) => {
      calls.push(`append:${accountId}:${mailbox}:${source.toString()}:${flags.join(',')}`);
    },
  } as unknown as ImapService;
  const smtp = smtpMock({
    send: async (_accountId, input) => {
      calls.push(`smtp:${input.to.join(',')}:${input.subject}`);
      return {
        messageId: '<sent@letter-box>',
        accepted: input.to,
        rejected: [],
        raw: Buffer.from('MIME'),
      };
    },
  });
  const mail = new MailService(repository, imap, smtp, accountsMock());

  const result = await mail.sendMessage('first', {
    to: ['to@example.com'],
    subject: 'Hello',
    text: 'Body',
  });

  assert.deepEqual(result, {
    messageId: '<sent@letter-box>',
    accepted: ['to@example.com'],
    rejected: [],
    sentMailbox: 'Sent',
  });
  assert.deepEqual(calls, [
    'smtp:to@example.com:Hello',
    'append:first:Sent:MIME:\\Seen',
  ]);
});

test('rejects send without recipients', async () => {
  const mail = new MailService(
    repositoryMock(),
    {} as ImapService,
    smtpMock(),
    accountsMock(),
  );
  await assert.rejects(
    () => mail.sendMessage('first', { to: [], subject: 'Hi', text: 'Body' }),
    /получателя/,
  );
});
