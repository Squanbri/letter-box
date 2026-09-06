import type { WebContents } from 'electron';
import {
  resolveOAuthProvider,
  type BasicAccountInput,
  type OAuthAccountInput,
  type OAuthCapableProviderId,
} from '@letter-box/contracts';
import {
  accessTokenNeedsRefresh,
  readAuthSession,
  saveSession,
  type DesktopAuthSession,
} from '../session-store';
import { BasicAuthStrategy, isCancelled, OAuthPkceStrategy } from './strategies';
import { OAuthManualCodeStrategy } from './manual-code';
import { tokenStore } from './token-store';
import type { OnboardingEvent } from './types';

export interface AddOAuthInput {
  providerId: OAuthCapableProviderId;
  accountId?: string;
}

export interface AddBasicInput extends BasicAccountInput {
  accountId?: string;
}

export class AccountOnboardingService {
  private active: OAuthPkceStrategy | OAuthManualCodeStrategy | null = null;
  private readonly apiUrl: string;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
  }

  async addOAuth(sender: WebContents, input: AddOAuthInput): Promise<unknown> {
    this.cancel();
    const config = resolveOAuthProvider(input.providerId);
    const strategy = config.authMode === 'oauth-manual-code'
      ? new OAuthManualCodeStrategy(config, (message) => {
        this.emit(sender, { phase: 'error', message });
      })
      : new OAuthPkceStrategy(config);
    this.active = strategy;
    this.emit(sender, {
      phase: config.authMode === 'oauth-manual-code' ? 'waiting-code' : 'waiting-browser',
    });
    try {
      const result = await strategy.authenticate();
      tokenStore.save(result.email, result, input.providerId);
      this.emit(sender, { phase: 'checking', email: result.email });
      const account = await this.persist(sender, input.accountId, {
        authType: 'oauth',
        provider: input.providerId,
        email: result.email,
        accessToken: result.accessToken!,
        refreshToken: result.refreshToken!,
        expiresAt: result.expiresAt!,
      } satisfies OAuthAccountInput);
      const accountId = (account as { id?: string }).id;
      if (accountId) tokenStore.save(accountId, result, input.providerId);
      this.emit(sender, { phase: 'success', email: result.email, account });
      return account;
    } catch (error) {
      if (!isCancelled(error)) {
        this.emit(sender, { phase: 'error', message: errorMessage(error) });
      }
      throw error;
    } finally {
      if (this.active === strategy) this.active = null;
    }
  }

  async addBasic(sender: WebContents, input: AddBasicInput): Promise<unknown> {
    this.emit(sender, { phase: 'checking' });
    try {
      const auth = await new BasicAuthStrategy(input).authenticate();
      const account = await this.persist(sender, input.accountId, {
        authType: 'basic',
        provider: input.provider,
        email: auth.email,
        password: auth.password ?? input.password,
        imapHost: input.imapHost,
        imapPort: input.imapPort,
        smtpHost: input.smtpHost,
        smtpPort: input.smtpPort,
        useSSL: input.useSSL,
      });
      this.emit(sender, { phase: 'success', email: auth.email, account });
      return account;
    } catch (error) {
      this.emit(sender, { phase: 'error', message: errorMessage(error) });
      throw error;
    }
  }

  cancel(): void {
    this.active?.cancel();
    this.active = null;
  }

  submitOAuthCode(code: string): void {
    if (!(this.active instanceof OAuthManualCodeStrategy)) {
      throw new Error('Сейчас не ожидается код Яндекса');
    }
    this.active.submitCode(code);
  }

  forget(key: string): void {
    tokenStore.delete(key);
  }

  private emit(sender: WebContents, event: OnboardingEvent): void {
    if (sender.isDestroyed()) return;
    sender.send('account:onboarding', event);
  }

  private async persist(
    sender: WebContents,
    accountId: string | undefined,
    body: unknown,
  ): Promise<unknown> {
    const session = await this.ensureSession(sender);
    const path = accountId
      ? `${this.apiUrl}/api/v1/accounts/${encodeURIComponent(accountId)}`
      : `${this.apiUrl}/api/v1/accounts`;
    const response = await this.authorizedRequest(sender, session, path, {
      method: accountId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
    if (!response.ok) {
      const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message;
      throw new Error(message ?? `Ошибка API: ${response.status}`);
    }
    return payload;
  }

  private async authorizedRequest(
    sender: WebContents,
    session: DesktopAuthSession,
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${session.accessToken}`);
    const response = await fetch(url, { ...init, headers });
    if (response.status !== 401) return response;
    const refreshed = await this.refreshSession(sender, session.refreshToken);
    headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
    return fetch(url, { ...init, headers });
  }

  private async ensureSession(sender: WebContents): Promise<DesktopAuthSession> {
    const session = readAuthSession();
    if (!session) {
      throw new Error('Сначала войдите в Letter Box');
    }
    if (!accessTokenNeedsRefresh(session.accessToken)) return session;
    try {
      return await this.refreshSession(sender, session.refreshToken);
    } catch {
      throw new Error('Сессия Letter Box истекла. Войдите в приложение и подключите почту ещё раз.');
    }
  }

  private async refreshSession(
    sender: WebContents,
    refreshToken: string,
  ): Promise<DesktopAuthSession> {
    const response = await fetch(`${this.apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      throw new Error('Сессия Letter Box истекла. Войдите в приложение и подключите почту ещё раз.');
    }
    const next = await response.json() as DesktopAuthSession;
    if (!next.accessToken || !next.refreshToken) {
      throw new Error('Сессия Letter Box истекла. Войдите в приложение и подключите почту ещё раз.');
    }
    saveSession(JSON.stringify(next));
    if (!sender.isDestroyed()) {
      sender.send('session:updated', JSON.stringify(next));
    }
    return next;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось подключить почту';
}
