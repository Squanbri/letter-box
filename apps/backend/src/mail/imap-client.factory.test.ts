import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchOAuthProvider,
  OAUTH_PROVIDERS,
  resolveOAuthProvider,
} from '@letter-box/contracts';
import { imapAuth, xoauth2Token } from './imap-client.factory';
import type { AccountConfig } from '../runtime';

test('matches known mailbox domains to oauth providers', () => {
  assert.equal(matchOAuthProvider('me@gmail.com'), 'gmail');
  assert.equal(matchOAuthProvider('me@googlemail.com'), 'gmail');
  assert.equal(matchOAuthProvider('me@yandex.ru'), 'yandex');
  assert.equal(matchOAuthProvider('me@ya.ru'), 'yandex');
  assert.equal(matchOAuthProvider('me@inbox.ru'), 'mailru');
  assert.equal(matchOAuthProvider('me@corp.mail.ru'), 'mailru');
  assert.equal(matchOAuthProvider('me@example.com'), null);
});

test('gmail scope includes IMAP access and openid email', () => {
  assert.match(OAUTH_PROVIDERS.gmail.scope ?? '', /mail\.google\.com/);
  assert.match(OAUTH_PROVIDERS.gmail.scope ?? '', /openid/);
  assert.equal(OAUTH_PROVIDERS.gmail.authMode, 'oauth-pkce');
});

test('yandex uses a fixed verification_code redirect, not loopback', () => {
  assert.equal(OAUTH_PROVIDERS.yandex.authMode, 'oauth-manual-code');
  assert.equal(OAUTH_PROVIDERS.yandex.redirectUri, 'https://oauth.yandex.ru/verification_code');
  assert.equal(OAUTH_PROVIDERS.yandex.scope, 'mail:imap_full mail:smtp');
});

test('mail.ru is basic auth with preset hosts and no oauth endpoints', () => {
  assert.equal(OAUTH_PROVIDERS.mailru.authMode, 'basic');
  assert.equal(OAUTH_PROVIDERS.mailru.scope, undefined);
  assert.equal(OAUTH_PROVIDERS.mailru.authEndpoint, undefined);
  assert.equal(OAUTH_PROVIDERS.mailru.imapHost, 'imap.mail.ru');
  assert.equal(OAUTH_PROVIDERS.mailru.smtpHost, 'smtp.mail.ru');
  assert.throws(
    () => resolveOAuthProvider('mailru', { OAUTH_MAILRU_CLIENT_ID: 'unused' }),
    /паролем приложения/,
  );
});

test('resolveOAuthProvider reads shared client from env', () => {
  const provider = resolveOAuthProvider('gmail', {
    OAUTH_GMAIL_CLIENT_ID: 'desktop.apps.googleusercontent.com',
    OAUTH_GMAIL_CLIENT_SECRET: 'secret',
  });
  assert.equal(provider.clientId, 'desktop.apps.googleusercontent.com');
  assert.equal(provider.authEndpoint, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(provider.clientSecret, 'secret');
  const yandex = resolveOAuthProvider('yandex', {
    OAUTH_YANDEX_CLIENT_ID: 'yandex-client',
    OAUTH_YANDEX_CLIENT_SECRET: 'yandex-secret',
  });
  assert.equal(yandex.authMode, 'oauth-manual-code');
  assert.equal(yandex.redirectUri, 'https://oauth.yandex.ru/verification_code');
});

test('resolveOAuthProvider fails without client id', () => {
  assert.throws(
    () => resolveOAuthProvider('yandex', {}),
    /OAUTH_YANDEX_CLIENT_ID/,
  );
});

test('builds XOAUTH2 SASL string for imapflow', () => {
  const token = xoauth2Token('me@gmail.com', 'ya29.token');
  assert.equal(
    Buffer.from(token, 'base64').toString('utf8'),
    'user=me@gmail.com\x01auth=Bearer ya29.token\x01\x01',
  );
  const account: AccountConfig = {
    id: '1',
    provider: 'gmail',
    email: 'me@gmail.com',
    authType: 'oauth',
    accessToken: 'ya29.token',
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: false,
  };
  assert.deepEqual(imapAuth(account), {
    user: 'me@gmail.com',
    accessToken: 'ya29.token',
  });
});
