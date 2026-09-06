import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AccountConfig } from '../runtime';
import { FileCredentialStore } from './file-credential.store';

const account: AccountConfig = {
  id: 'account-1',
  provider: 'mailru',
  email: 'user@example.com',
  authType: 'basic',
  password: 'application-password',
  host: 'imap.mail.ru',
  port: 993,
  secure: true,
  smtpHost: 'smtp.mail.ru',
  smtpPort: 587,
  smtpSecure: false,
};

test('encrypts, reloads, updates, and deletes server credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'letter-box-credentials-'));
  const path = join(directory, 'credentials.json');
  try {
    const store = new FileCredentialStore(path, 'test-encryption-key');
    await store.save(account);
    const raw = readFileSync(path, 'utf8');
    assert.equal(raw.includes(account.password ?? ''), false);
    assert.deepEqual(await store.loadAll(), [account]);

    await store.save({ ...account, password: 'new-password' });
    assert.equal((await store.loadAll())[0]?.password, 'new-password');

    await store.delete(account.id);
    assert.deepEqual(await store.loadAll(), []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('encrypts oauth tokens without storing them in plaintext', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'letter-box-oauth-credentials-'));
  const path = join(directory, 'credentials.json');
  const { password: _unused, ...withoutPassword } = account;
  const oauth: AccountConfig = {
    ...withoutPassword,
    authType: 'oauth',
    accessToken: 'ya29.access',
    refreshToken: '1//refresh',
    expiresAt: 1_700_000_000_000,
  };
  try {
    const store = new FileCredentialStore(path, 'test-encryption-key');
    await store.save(oauth);
    const raw = readFileSync(path, 'utf8');
    assert.equal(raw.includes('ya29.access'), false);
    assert.equal(raw.includes('1//refresh'), false);
    assert.deepEqual(await store.loadAll(), [oauth]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('does not decrypt credentials with another server key', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'letter-box-credentials-key-'));
  const path = join(directory, 'credentials.json');
  try {
    await new FileCredentialStore(path, 'correct-key').save(account);
    await assert.rejects(
      new FileCredentialStore(path, 'wrong-key').loadAll(),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
