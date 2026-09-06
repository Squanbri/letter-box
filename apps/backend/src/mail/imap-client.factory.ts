import type { AccountConfig } from '../runtime';
import type { ImapFlowOptions } from 'imapflow';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export function xoauth2Token(email: string, accessToken: string): string {
  return Buffer.from(`user=${email}\x01auth=Bearer ${accessToken}\x01\x01`, 'utf8')
    .toString('base64');
}

export function mailUsername(account: {
  provider: AccountConfig['provider'];
  email: string;
}): string {
  if (account.provider !== 'yandex') return account.email;
  const [localPart, domain] = account.email.split('@');
  return localPart && ['yandex.ru', 'ya.ru'].includes(domain?.toLowerCase())
    ? localPart
    : account.email;
}

export function imapAuth(account: AccountConfig): ImapFlowOptions['auth'] {
  const user = mailUsername(account);
  if (account.authType === 'oauth') {
    if (!account.accessToken) {
      throw new Error('У OAuth-аккаунта нет access token');
    }
    return { user, accessToken: account.accessToken };
  }
  return { user, pass: account.password ?? '' };
}

export function smtpAuth(
  account: AccountConfig,
): SMTPTransport.Options['auth'] {
  const user = mailUsername(account);
  if (account.authType === 'oauth') {
    if (!account.accessToken) {
      throw new Error('У OAuth-аккаунта нет access token');
    }
    return {
      type: 'OAuth2',
      user,
      accessToken: account.accessToken,
    };
  }
  return { user, pass: account.password ?? '' };
}

export function imapClientOptions(account: AccountConfig): ImapFlowOptions {
  return {
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: imapAuth(account),
    logger: false,
  };
}

export class ImapClientFactory {
  options(account: AccountConfig): ImapFlowOptions {
    return imapClientOptions(account);
  }
}
