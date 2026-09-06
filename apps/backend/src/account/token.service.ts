import {
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { resolveOAuthProvider } from '@letter-box/contracts';
import type { AccountConfig } from '../runtime';
import { AccountService } from './account.service';

const REFRESH_SKEW_MS = 5 * 60 * 1_000;

@Injectable()
export class TokenService {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  async ensureFresh(accountId: string): Promise<AccountConfig> {
    const account = this.accounts.getConfig(accountId);
    if (account.authType !== 'oauth') return account;
    if (account.expiresAt && account.expiresAt - Date.now() > REFRESH_SKEW_MS) {
      return account;
    }
    return this.refresh(account);
  }

  async refreshDue(): Promise<number> {
    let refreshed = 0;
    for (const account of this.accounts.listConfigs()) {
      if (account.authType !== 'oauth') continue;
      if (account.expiresAt && account.expiresAt - Date.now() > REFRESH_SKEW_MS) {
        continue;
      }
      try {
        await this.refresh(account);
        refreshed += 1;
      } catch (error) {
        console.warn('[backend:oauth] плановый refresh не удался', {
          accountId: account.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return refreshed;
  }

  async refresh(account: AccountConfig): Promise<AccountConfig> {
    if (account.authType !== 'oauth' || !account.refreshToken) {
      throw new UnauthorizedException('Нет refresh token для обновления доступа');
    }
    if (account.provider !== 'gmail' && account.provider !== 'yandex') {
      throw new UnauthorizedException('OAuth-токены есть только у Gmail и Яндекса');
    }
    const provider = resolveOAuthProvider(account.provider);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      client_id: provider.clientId,
    });
    if (provider.clientSecret) body.set('client_secret', provider.clientSecret);
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (provider.clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(
        `${provider.clientId}:${provider.clientSecret}`,
      ).toString('base64')}`;
    }
    let response: Response;
    try {
      response = await fetch(provider.tokenEndpoint, {
        method: 'POST',
        headers,
        body,
      });
    } catch (error) {
      throw new UnauthorizedException(
        `Не удалось обновить токен: ${error instanceof Error ? error.message : 'сеть недоступна'}`,
      );
    }
    const payload = await response.json().catch(() => ({})) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || payload.error) {
      if (payload.error === 'invalid_grant') {
        await this.accounts.setStatus(
          account.id,
          'needs_reauth',
          'Требуется повторная авторизация почтового ящика',
        );
        throw new UnauthorizedException(
          'Сессия почтового ящика истекла. Подключите аккаунт заново.',
        );
      }
      throw new UnauthorizedException(
        payload.error_description
          ?? payload.error
          ?? `Ошибка обновления токена (${response.status})`,
      );
    }
    if (!payload.access_token) {
      throw new UnauthorizedException('Провайдер не вернул access token');
    }
    const next: AccountConfig = {
      ...account,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? account.refreshToken,
      expiresAt: Date.now() + Math.max(Number(payload.expires_in) || 3_600, 60) * 1_000,
    };
    await this.accounts.persistCredentials(next);
    return next;
  }
}
