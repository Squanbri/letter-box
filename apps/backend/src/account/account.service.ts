import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { AccountConfig, getRuntimeOptions } from '../runtime';

export interface SaveAccountInput {
  provider: 'mailru' | 'yandex';
  email: string;
  password: string;
}

@Injectable()
export class AccountService implements OnModuleInit {
  private account: AccountConfig | null = null;

  async onModuleInit(): Promise<void> {
    const stored = await getRuntimeOptions().credentialStore?.load();
    this.account = stored ?? this.fromEnvironment();
  }

  getAccount(): AccountConfig | null {
    return this.account;
  }

  status(): { configured: boolean; email: string | null; provider: string | null } {
    return {
      configured: this.account !== null,
      email: this.account?.email ?? null,
      provider: this.account?.provider ?? null,
    };
  }

  prepare(input: SaveAccountInput): AccountConfig {
    const email = input.email.trim();
    const password = input.password.trim();

    if (!email || !password) {
      throw new BadRequestException('Укажите email и пароль приложения');
    }

    const server = input.provider === 'yandex'
      ? { host: 'imap.yandex.ru', port: 993, secure: true }
      : { host: 'imap.mail.ru', port: 993, secure: true };

    return { ...server, provider: input.provider, email, password };
  }

  use(account: AccountConfig | null): void {
    this.account = account;
  }

  async persist(account: AccountConfig): Promise<void> {
    const store = getRuntimeOptions().credentialStore;
    if (store) {
      await store.save(account);
    }
    this.account = account;
  }

  private fromEnvironment(): AccountConfig | null {
    const host = process.env.IMAP_HOST;
    const email = process.env.IMAP_USER;
    const password = process.env.IMAP_PASSWORD;
    if (!host || !email || !password) {
      return null;
    }

    return {
      provider: host.includes('yandex') ? 'yandex' : 'mailru',
      email,
      password,
      host,
      port: Number(process.env.IMAP_PORT ?? 993),
      secure: process.env.IMAP_SECURE !== 'false',
    };
  }
}

