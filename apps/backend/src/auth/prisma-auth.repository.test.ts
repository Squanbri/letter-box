import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import { PrismaAuthRepository } from './prisma-auth.repository';

test('registers a user and rotates a refresh session through Prisma', {
  skip: !process.env.POSTGRES_TEST_URL,
}, async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.POSTGRES_TEST_URL;
  const database = new PrismaDatabaseService();
  await database.onModuleInit();
  const repository = new PrismaAuthRepository(database);
  const user = {
    id: randomUUID(),
    email: `${randomUUID()}@example.com`,
    passwordHash: 'test-password-hash',
  };
  const now = new Date();

  try {
    const registration = await repository.register(
      user,
      now.toISOString(),
      true,
    );
    assert.equal(registration.status, 'created');
    assert.equal((await repository.findByEmail(user.email))?.id, user.id);

    await repository.createSession(
      randomUUID(),
      user.id,
      'first-hash',
      new Date(now.getTime() + 60_000).toISOString(),
      now.toISOString(),
    );
    const rotated = await repository.rotateSession('first-hash', {
      id: randomUUID(),
      tokenHash: 'second-hash',
      expiresAt: new Date(now.getTime() + 120_000).toISOString(),
      createdAt: new Date(now.getTime() + 1_000).toISOString(),
    });
    assert.deepEqual(rotated, { id: user.id, email: user.email });
    assert.equal(
      await repository.rotateSession('first-hash', {
        id: randomUUID(),
        tokenHash: 'replayed-hash',
        expiresAt: new Date(now.getTime() + 180_000).toISOString(),
        createdAt: new Date(now.getTime() + 2_000).toISOString(),
      }),
      undefined,
    );
  } finally {
    await database.client.user.deleteMany({ where: { id: user.id } });
    await database.onModuleDestroy();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
