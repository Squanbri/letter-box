import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  OAUTH_PROVIDERS,
  type AccountInput,
  type AccountStatus as ContractAccountStatus,
  type BasicAccountInput,
  type OAuthAccountInput,
} from '@letter-box/contracts';
import { AccountConfig, getRuntimeOptions } from '../runtime';
import type { AccountRow } from './account.types';
import {
  ACCOUNT_REPOSITORY,
  AccountRepositoryContract,
} from '../database/repository.contracts';
import {
  syncBackoffBaseMs,
  syncBackoffMaxMs,
} from '../sync/sync-queue.types';

export type SaveAccountInput = AccountInput;
export type AccountStatus = ContractAccountStatus;

@Injectable()
export class AccountService implements OnModuleInit {
  private readonly credentials = new Map<string, AccountConfig>();

  constructor(
    @Inject(ACCOUNT_REPOSITORY)
    private readonly repository: AccountRepositoryContract,
  ) {}

  async onModuleInit(): Promise<void> {
    const stored = await getRuntimeOptions().credentialStore?.loadAll() ?? [];
    const now = new Date().toISOString();
    if (process.env.LETTER_BOX_PROCESS_ROLE !== 'worker') {
      await this.repository.resetConnectionStatuses(now);
    }
    for (const account of stored) {
      this.credentials.set(account.id, account);
      await this.repository.upsertStored(account, now);
    }
  }

  async list(userId: string | null = null): Promise<AccountStatus[]> {
    return (await this.repository.list(userId)).map(this.mapStatus);
  }

  async listAll(): Promise<AccountStatus[]> {
    return (await this.repository.listAll()).map(this.mapStatus);
  }

  async get(accountId: string, userId: string | null = null): Promise<AccountStatus> {
    const row = await this.repository.find(userId, accountId);
    if (!row) throw new NotFoundException('Аккаунт не найден');
    return this.mapStatus(row);
  }

  getConfig(accountId: string): AccountConfig {
    const account = this.credentials.get(accountId);
    if (!account) throw new NotFoundException('Credentials аккаунта не найдены');
    return account;
  }

  listConfigs(): AccountConfig[] {
    return [...this.credentials.values()];
  }

  hasCredentials(accountId: string): boolean {
    return this.credentials.has(accountId);
  }

  async reloadCredential(accountId: string): Promise<void> {
    const stored = await getRuntimeOptions().credentialStore?.loadAll() ?? [];
    const account = stored.find((candidate) => candidate.id === accountId);
    if (!account) {
      this.credentials.delete(accountId);
      throw new NotFoundException('Credentials аккаунта не найдены');
    }
    this.credentials.set(accountId, account);
  }

  prepare(input: SaveAccountInput, id: string = randomUUID()): AccountConfig {
    return isOAuthInput(input)
      ? this.prepareOAuth(input, id)
      : this.prepareBasic(input, id);
  }

  use(account: AccountConfig): void {
    this.credentials.set(account.id, account);
  }

  async persistCredentials(account: AccountConfig): Promise<void> {
    await getRuntimeOptions().credentialStore?.save(account);
    this.credentials.set(account.id, account);
  }

  async persist(account: AccountConfig, userId: string | null = null): Promise<void> {
    await this.persistCredentials(account);
    const now = new Date().toISOString();
    await this.repository.saveConnected(account, userId, now);
  }

  async setStatus(
    accountId: string,
    status: AccountStatus['status'],
    error: string | null = null,
  ): Promise<void> {
    await this.repository.setStatus(accountId, status, error, new Date().toISOString());
  }

  async markSynced(accountId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.repository.markSynced(accountId, now);
  }

  async isSyncBackoffActive(accountId: string): Promise<boolean> {
    const state = await this.repository.getSyncBackoff(accountId);
    if (!state?.backoffUntil) return false;
    return Date.parse(state.backoffUntil) > Date.now();
  }

  async getSyncBackoffRemainingMs(accountId: string): Promise<number> {
    const state = await this.repository.getSyncBackoff(accountId);
    if (!state?.backoffUntil) return 0;
    return Math.max(0, Date.parse(state.backoffUntil) - Date.now());
  }

  /**
   * Exponential backoff for connection/auth failures.
   * delay = min(max, base * 2^(failCount-1))
   */
  async recordSyncFailure(accountId: string, error: string): Promise<void> {
    const now = new Date();
    const previous = await this.repository.getSyncBackoff(accountId);
    const failCount = (previous?.failCount ?? 0) + 1;
    const delay = Math.min(
      syncBackoffMaxMs(),
      syncBackoffBaseMs() * (2 ** Math.max(failCount - 1, 0)),
    );
    const backoffUntil = new Date(now.getTime() + delay).toISOString();
    await this.repository.recordSyncFailure(
      accountId,
      error,
      backoffUntil,
      failCount,
      now.toISOString(),
    );
    console.warn('[sync:backoff]', {
      accountId,
      failCount,
      delayMs: delay,
      backoffUntil,
      error,
    });
  }

  async remove(accountId: string, userId: string | null = null): Promise<void> {
    await this.get(accountId, userId);
    await getRuntimeOptions().credentialStore?.delete(accountId);
    this.credentials.delete(accountId);
    await this.repository.remove(userId, accountId);
  }

  async clearMailData(accountId: string): Promise<void> {
    await this.repository.clearMailData(accountId);
  }

  private prepareOAuth(input: OAuthAccountInput, id: string): AccountConfig {
    const email = input.email.trim().toLowerCase();
    if (!email || !input.accessToken || !input.refreshToken) {
      throw new BadRequestException('OAuth-ответ неполный: нет email или токенов');
    }
    const provider = OAUTH_PROVIDERS[input.provider];
    if (!provider || provider.authMode === 'basic') {
      throw new BadRequestException('Этот провайдер подключается без OAuth');
    }
    return {
      id,
      provider: input.provider,
      email,
      authType: 'oauth',
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAt: input.expiresAt,
      host: provider.imapHost,
      port: provider.imapPort,
      secure: true,
      smtpHost: provider.smtpHost,
      smtpPort: provider.smtpPort,
      smtpSecure: provider.smtpSecure,
    };
  }

  private prepareBasic(input: BasicAccountInput, id: string): AccountConfig {
    const email = input.email.trim().toLowerCase();
    const password = input.provider === 'gmail'
      ? input.password.replace(/\s+/g, '')
      : input.password.trim();
    if (!email || !password) {
      throw new BadRequestException('Укажите email и пароль приложения');
    }
    const servers = this.basicServers(input);
    return {
      id,
      provider: servers.provider,
      email,
      authType: 'basic',
      password,
      host: servers.host,
      port: servers.port,
      secure: servers.secure,
      smtpHost: servers.smtpHost,
      smtpPort: servers.smtpPort,
      smtpSecure: servers.smtpSecure,
    };
  }

  private basicServers(input: BasicAccountInput): {
    provider: AccountConfig['provider'];
    host: string;
    port: number;
    secure: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
  } {
    if (input.provider === 'imap') {
      const host = input.imapHost?.trim();
      const smtpHost = input.smtpHost?.trim();
      if (!host || !smtpHost) {
        throw new BadRequestException('Для IMAP укажите хосты IMAP и SMTP');
      }
      const imapPort = input.imapPort ?? (input.useSSL === false ? 143 : 993);
      const smtpPort = input.smtpPort ?? 587;
      return {
        provider: 'imap',
        host,
        port: imapPort,
        secure: input.useSSL !== false && imapPort !== 143,
        smtpHost,
        smtpPort,
        smtpSecure: smtpPort === 465,
      };
    }
    const provider = input.provider;
    const defaults = OAUTH_PROVIDERS[provider];
    return {
      provider,
      host: defaults.imapHost,
      port: defaults.imapPort,
      secure: true,
      smtpHost: defaults.smtpHost,
      smtpPort: defaults.smtpPort,
      smtpSecure: defaults.smtpSecure,
    };
  }

  private mapStatus(row: AccountRow): AccountStatus {
    return {
      id: row.id, provider: row.provider, email: row.email, status: row.status,
      lastError: row.last_error, lastSyncAt: row.last_sync_at,
      unreadCount: row.unread_count,
    };
  }
}

export function isOAuthInput(input: AccountInput): input is OAuthAccountInput {
  return input.authType === 'oauth';
}
