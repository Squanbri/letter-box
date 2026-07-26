import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import type { AccountConfig } from '../runtime';
import { PostgresAccountRepository } from './postgres-account.repository';

test('stores and isolates an account in PostgreSQL', {
  skip: !process.env.POSTGRES_TEST_URL,
}, async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.POSTGRES_TEST_URL;
  const database = new PostgresDatabaseService();
  await database.onModuleInit();
  const repository = new PostgresAccountRepository(database);
  const id = randomUUID();
  const userId = randomUUID();
  const now = new Date().toISOString();
  const account: AccountConfig = {
    id,
    provider: 'mailru',
    email: `${id}@example.com`,
    password: 'secret',
    host: 'imap.mail.ru',
    port: 993,
    secure: true,
  };

  try {
    await database.query(
      `INSERT INTO users (id, email, password_hash, created_at, updated_at)
       VALUES ($1, $2, 'test', $3, $3)`,
      [userId, `${userId}@example.com`, now],
    );
    await repository.saveConnected(account, userId, now);
    assert.equal((await repository.find(null, id))?.email, account.email);
    assert.equal((await repository.find(userId, id))?.email, account.email);
    assert.equal(await repository.find(randomUUID(), id), undefined);
    await repository.setStatus(id, 'error', 'test error', now);
    assert.equal((await repository.find(null, id))?.last_error, 'test error');
    await repository.remove(userId, id);
    assert.equal(await repository.find(null, id), undefined);
  } finally {
    await database.query('DELETE FROM accounts WHERE id = $1', [id]);
    await database.query('DELETE FROM users WHERE id = $1', [userId]);
    await database.onModuleDestroy();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
