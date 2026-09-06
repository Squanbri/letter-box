import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AccountConfig, CredentialStore } from '../runtime';

interface EncryptedAccount {
  id: string;
  provider: AccountConfig['provider'];
  email: string;
  host: string;
  port: number;
  secure: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  authType?: AccountConfig['authType'];
  iv: string;
  tag: string;
  ciphertext: string;
}

interface CredentialSecret {
  authType: AccountConfig['authType'];
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export class FileCredentialStore implements CredentialStore {
  private readonly filePath: string;
  private readonly key: Buffer;

  constructor(
    filePath = process.env.CREDENTIALS_PATH ?? './data/credentials.json',
    secret = process.env.LETTER_BOX_ENCRYPTION_KEY ?? 'letter-box-development-key',
  ) {
    this.filePath = resolve(filePath);
    this.key = createHash('sha256').update(secret).digest();
    if (!process.env.LETTER_BOX_ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
      throw new Error('LETTER_BOX_ENCRYPTION_KEY обязателен в production');
    }
  }

  async loadAll(): Promise<AccountConfig[]> {
    try {
      const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as EncryptedAccount[];
      return stored.map((account) => this.toConfig(account));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async save(account: AccountConfig): Promise<void> {
    const accounts = await this.readEncrypted();
    const encrypted = this.encrypt(account);
    const index = accounts.findIndex((item) => item.id === account.id);
    if (index >= 0) accounts[index] = encrypted;
    else accounts.push(encrypted);
    await this.writeEncrypted(accounts);
  }

  async delete(accountId: string): Promise<void> {
    const accounts = await this.readEncrypted();
    await this.writeEncrypted(accounts.filter((account) => account.id !== accountId));
  }

  private toConfig(account: EncryptedAccount): AccountConfig {
    const secret = this.decrypt(account);
    return {
      id: account.id,
      provider: account.provider,
      email: account.email,
      host: account.host,
      port: account.port,
      secure: account.secure,
      smtpHost: account.smtpHost ?? smtpHostFor(account.provider, account.host),
      smtpPort: account.smtpPort ?? 587,
      smtpSecure: account.smtpSecure ?? false,
      authType: secret.authType,
      ...(secret.password ? { password: secret.password } : {}),
      ...(secret.accessToken ? { accessToken: secret.accessToken } : {}),
      ...(secret.refreshToken ? { refreshToken: secret.refreshToken } : {}),
      ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
    };
  }

  private encrypt(account: AccountConfig): EncryptedAccount {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const secret: CredentialSecret = {
      authType: account.authType,
      password: account.password,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      expiresAt: account.expiresAt,
    };
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secret), 'utf8'),
      cipher.final(),
    ]);
    return {
      id: account.id,
      provider: account.provider,
      email: account.email,
      host: account.host,
      port: account.port,
      secure: account.secure,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort,
      smtpSecure: account.smtpSecure,
      authType: account.authType,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private decrypt(account: EncryptedAccount): CredentialSecret {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(account.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(account.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(account.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return parseSecret(plaintext, account.authType);
  }

  private async readEncrypted(): Promise<EncryptedAccount[]> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as EncryptedAccount[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async writeEncrypted(accounts: EncryptedAccount[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(accounts, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}

function parseSecret(
  plaintext: string,
  fallbackType: AccountConfig['authType'] | undefined,
): CredentialSecret {
  try {
    const parsed = JSON.parse(plaintext) as CredentialSecret;
    if (parsed && (parsed.authType === 'oauth' || parsed.authType === 'basic')) {
      return parsed;
    }
  } catch {
    /* legacy password-only ciphertext */
  }
  return {
    authType: fallbackType ?? 'basic',
    password: plaintext,
  };
}

function smtpHostFor(provider: AccountConfig['provider'], imapHost: string): string {
  if (provider === 'gmail') return 'smtp.gmail.com';
  if (provider === 'yandex') return 'smtp.yandex.ru';
  if (provider === 'mailru') return 'smtp.mail.ru';
  return imapHost.replace(/^imap\./i, 'smtp.');
}
