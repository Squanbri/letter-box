import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { configureRuntime } from '../runtime';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

test('registers the first user, claims legacy accounts, and logs in', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'letter-box-auth-'));
  configureRuntime({ databasePath: join(directory, 'auth.db') });
  const database = new DatabaseService();
  database.onModuleInit();
  const accountId = randomUUID();
  const now = new Date().toISOString();
  database.db.prepare(`
    INSERT INTO accounts (id, provider, email, status, created_at, updated_at)
    VALUES (?, 'mailru', 'mail@example.com', 'connected', ?, ?)
  `).run(accountId, now, now);
  const repository = new AuthRepository(database);
  const auth = new AuthService(repository, new JwtService({ secret: 'test-secret' }));

  try {
    const registered = await auth.register({
      email: ' User@Example.com ',
      password: 'long-test-password',
    });
    assert.equal(registered.user.email, 'user@example.com');
    assert.ok(registered.accessToken);
    assert.ok(registered.refreshToken);
    assert.equal(
      (database.db.prepare(
        'SELECT user_id FROM accounts WHERE id = ?',
      ).get(accountId) as { user_id: string }).user_id,
      registered.user.id,
    );

    const loggedIn = await auth.login({
      email: 'user@example.com',
      password: 'long-test-password',
    });
    assert.equal(loggedIn.user.id, registered.user.id);
    const refreshed = await auth.refresh({ refreshToken: registered.refreshToken });
    assert.notEqual(refreshed.refreshToken, registered.refreshToken);
    await assert.rejects(
      auth.refresh({ refreshToken: registered.refreshToken }),
      /Refresh token недействителен или истёк/,
    );
    await auth.logout(registered.user.id, { refreshToken: refreshed.refreshToken });
    await assert.rejects(
      auth.refresh({ refreshToken: refreshed.refreshToken }),
      /Refresh token недействителен или истёк/,
    );
    await assert.rejects(
      auth.login({ email: 'user@example.com', password: 'wrong-password' }),
      /Неверный email или пароль/,
    );
  } finally {
    database.onModuleDestroy();
    rmSync(directory, { recursive: true, force: true });
  }
});
