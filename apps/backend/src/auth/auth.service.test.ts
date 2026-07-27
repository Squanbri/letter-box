import assert from 'node:assert/strict';
import test from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { AuthRepositoryContract, StoredUser } from './auth.contract';
import { AuthService } from './auth.service';

function memoryAuthRepository() {
  const users = new Map<string, StoredUser>();
  const sessions = new Map<string, { userId: string; expiresAt: string }>();
  let unownedClaimedBy: string | null = null;

  const repository: AuthRepositoryContract = {
    count: async () => users.size,
    findByEmail: async (email) => [...users.values()].find((user) => user.email === email),
    findById: async (id) => {
      const user = users.get(id);
      return user && { id: user.id, email: user.email };
    },
    create: async (user) => {
      users.set(user.id, user);
      return { id: user.id, email: user.email };
    },
    claimUnownedAccounts: async (userId) => {
      unownedClaimedBy = userId;
    },
    register: async (user, _now, allowRegistration) => {
      if (users.size > 0 && !allowRegistration) return { status: 'disabled' };
      if ([...users.values()].some((existing) => existing.email === user.email)) {
        return { status: 'email-exists' };
      }
      users.set(user.id, user);
      if (users.size === 1) unownedClaimedBy = user.id;
      return { status: 'created', user: { id: user.id, email: user.email } };
    },
    createSession: async (_id, userId, tokenHash, expiresAt) => {
      sessions.set(tokenHash, { userId, expiresAt });
    },
    rotateSession: async (currentHash, next) => {
      const current = sessions.get(currentHash);
      if (!current || Date.parse(current.expiresAt) <= Date.now()) return undefined;
      sessions.delete(currentHash);
      sessions.set(next.tokenHash, {
        userId: current.userId,
        expiresAt: next.expiresAt,
      });
      const user = users.get(current.userId);
      return user && { id: user.id, email: user.email };
    },
    revokeSession: async (userId, tokenHash) => {
      const session = sessions.get(tokenHash);
      if (session?.userId === userId) sessions.delete(tokenHash);
    },
  };

  return {
    repository,
    claimedBy: () => unownedClaimedBy,
  };
}

test('registers the first user, claims legacy accounts, and logs in', async () => {
  const { repository, claimedBy } = memoryAuthRepository();
  const auth = new AuthService(
    repository,
    new JwtService({ secret: 'test-secret' }),
  );
  process.env.ALLOW_REGISTRATION = 'false';

  const registered = await auth.register({
    email: ' User@Example.com ',
    password: 'long-test-password',
  });
  assert.equal(registered.user.email, 'user@example.com');
  assert.ok(registered.accessToken);
  assert.ok(registered.refreshToken);
  assert.equal(claimedBy(), registered.user.id);

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
});
