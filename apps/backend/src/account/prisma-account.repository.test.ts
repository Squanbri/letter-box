import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import type { AccountConfig } from '../runtime';
import { PrismaAccountRepository } from './prisma-account.repository';

test('stores and isolates an account in PostgreSQL', {
  skip: !process.env.POSTGRES_TEST_URL,
}, async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.POSTGRES_TEST_URL;
  const prisma = new PrismaDatabaseService();
  await prisma.onModuleInit();
  const repository = new PrismaAccountRepository(prisma);
  const id = randomUUID();
  const userId = randomUUID();
  const now = new Date().toISOString();
  const account: AccountConfig = {
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

  try {
    await prisma.client.user.create({
      data: {
        id: userId,
        email: `${userId}@example.com`,
        passwordHash: 'test',
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    });
    await repository.saveConnected(account, userId, now);
    assert.equal((await repository.find(null, id))?.email, account.email);
    assert.equal((await repository.find(userId, id))?.email, account.email);
    assert.equal(await repository.find(randomUUID(), id), undefined);
    await repository.setStatus(id, 'error', 'test error', now);
    assert.equal((await repository.find(null, id))?.last_error, 'test error');
    await repository.remove(userId, id);
    assert.equal(await repository.find(null, id), undefined);
  } finally {
    await prisma.client.account.deleteMany({ where: { id } });
    await prisma.client.user.deleteMany({ where: { id: userId } });
    await prisma.onModuleDestroy();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
