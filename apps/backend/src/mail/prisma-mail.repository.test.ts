import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaAccountRepository } from '../account/prisma-account.repository';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import type { AccountConfig } from '../runtime';
import { PrismaMailRepository } from './prisma-mail.repository';

test('isolates composite message keys and applies changes in PostgreSQL', {
  skip: !process.env.POSTGRES_TEST_URL,
}, async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.POSTGRES_TEST_URL;
  const prisma = new PrismaDatabaseService();
  await prisma.onModuleInit();
  const accounts = new PrismaAccountRepository(prisma);
  const mail = new PrismaMailRepository(prisma);
  const first = account(randomUUID());
  const second = account(randomUUID());
  const now = new Date().toISOString();

  try {
    await accounts.saveConnected(first, null, now);
    await accounts.saveConnected(second, null, now);
    await mail.replaceMailboxes(first.id, [
      mailbox('INBOX', '\\Inbox'),
      mailbox('Archive', '\\Archive'),
    ]);
    await mail.saveMessages(first.id, 'INBOX', [message(42, [])]);
    await mail.saveMessages(first.id, 'Archive', [message(42, ['\\Seen'])]);
    await mail.saveMessages(second.id, 'INBOX', [message(42, [])]);

    assert.equal((await mail.findMessage(first.id, 'INBOX', 42))?.uid, 42);
    assert.equal((await mail.findMessage(first.id, 'Archive', 42))?.uid, 42);
    assert.equal((await mail.findMessage(second.id, 'INBOX', 42))?.uid, 42);

    const removed = await mail.applyChanges(first.id, 'INBOX', {
      uidValidity: '1',
      reset: false,
      serverUids: [43],
      messages: [message(43, ['\\Flagged'])],
      flagUpdates: [],
      classificationPreparations: [{
        uid: 43,
        text: 'Prepared message',
        status: 'pending',
      }],
    });
    assert.equal(removed, 1);
    assert.deepEqual(await mail.knownUids(first.id, 'INBOX'), [43]);
    assert.deepEqual(
      JSON.parse((await mail.findMessage(first.id, 'INBOX', 43))!.flags),
      ['\\Flagged'],
    );
    assert.equal(
      (await mail.findMessage(first.id, 'INBOX', 43))?.classification_text,
      'Prepared message',
    );
    assert.equal(
      (await mail.findMessage(first.id, 'INBOX', 43))?.classification_status,
      'pending',
    );
    assert.equal((await accounts.find(null, first.id))?.unread_count, 1);
  } finally {
    await accounts.remove(null, first.id);
    await accounts.remove(null, second.id);
    await prisma.onModuleDestroy();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});

function account(id: string): AccountConfig {
  return {
    id,
    provider: 'mailru',
    email: `${id}@example.com`,
    authType: 'basic',
    password: 'secret',
    host: 'imap.mail.ru',
    port: 993,
    secure: true,
    smtpHost: 'smtp.mail.ru',
    smtpPort: 587,
    smtpSecure: false,
  };
}

function mailbox(path: string, specialUse: string) {
  return {
    path,
    name: path,
    delimiter: '/',
    specialUse,
    totalCount: 0,
    unreadCount: 0,
  };
}

function message(uid: number, flags: string[]) {
  return {
    uid,
    subject: `Message ${uid}`,
    senderName: null,
    senderAddress: 'sender@example.com',
    date: new Date(uid * 1000).toISOString(),
    flags,
    size: uid,
    messageId: `<msg-${uid}@example.com>`,
    inReplyTo: null,
    references: [] as string[],
    threadId: `<msg-${uid}@example.com>`,
  };
}
