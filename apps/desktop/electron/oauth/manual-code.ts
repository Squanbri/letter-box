import { shell } from 'electron';
import type { ResolvedOAuthProvider } from '@letter-box/contracts';
import { OAuthCancelledError } from './loopback';
import { randomOAuthState } from './pkce';
import { fetchProviderEmail } from './strategies';
import type { AuthResult, AuthStrategy, TokenResult } from './types';

const CODE_WAIT_MS = 10 * 60 * 1_000;
const YANDEX_REDIRECT = 'https://oauth.yandex.ru/verification_code';

export class OAuthManualCodeStrategy implements AuthStrategy {
  private waiting:
    | { resolve: (code: string) => void; reject: (error: Error) => void }
    | null = null;
  private queuedCode: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: ResolvedOAuthProvider,
    private readonly onInvalidCode?: (message: string) => void,
  ) {}

  async authenticate(): Promise<AuthResult> {
    const state = randomOAuthState();
    await shell.openExternal(buildYandexAuthUrl(this.config, state));
    let tokens: TokenResult | null = null;
    while (!tokens) {
      const code = await this.waitForCode();
      try {
        tokens = await exchangeYandexCode(this.config, code);
      } catch (error) {
        if (error instanceof OAuthCancelledError) throw error;
        this.onInvalidCode?.(error instanceof Error ? error.message : 'Яндекс отклонил код');
      }
    }
    const email = await fetchProviderEmail(this.config, tokens.accessToken);
    return {
      type: 'oauth',
      email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    };
  }

  submitCode(code: string): void {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (this.waiting) {
      this.waiting.resolve(trimmed);
      this.waiting = null;
      return;
    }
    this.queuedCode = trimmed;
  }

  cancel(): void {
    this.waiting?.reject(new OAuthCancelledError());
    this.waiting = null;
    this.queuedCode = null;
    this.clearTimer();
  }

  private waitForCode(): Promise<string> {
    if (this.queuedCode) {
      const code = this.queuedCode;
      this.queuedCode = null;
      return Promise.resolve(code);
    }
    return new Promise<string>((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.clearTimer();
      this.timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error('Истекло время ожидания кода Яндекса'));
      }, CODE_WAIT_MS);
      this.timer.unref();
    }).finally(() => this.clearTimer());
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function buildYandexAuthUrl(config: ResolvedOAuthProvider, state: string): string {
  const url = new URL(config.authEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri ?? YANDEX_REDIRECT);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  for (const [key, value] of Object.entries(config.extraAuthParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function exchangeYandexCode(
  config: ResolvedOAuthProvider,
  code: string,
): Promise<TokenResult> {
  const withoutRedirect = await requestYandexToken(config, code, false);
  if (withoutRedirect.ok) return withoutRedirect.tokens;
  const withRedirect = await requestYandexToken(config, code, true);
  if (withRedirect.ok) return withRedirect.tokens;
  throw new Error(withRedirect.error ?? withoutRedirect.error ?? 'Яндекс отклонил код подтверждения');
}

async function requestYandexToken(
  config: ResolvedOAuthProvider,
  code: string,
  includeRedirect: boolean,
): Promise<{ ok: true; tokens: TokenResult } | { ok: false; error: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  if (includeRedirect) {
    body.set('redirect_uri', config.redirectUri ?? YANDEX_REDIRECT);
  }
  let response: Response;
  try {
    response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
  } catch (error) {
    return {
      ok: false,
      error: `Не удалось обменять код Яндекса: ${error instanceof Error ? error.message : 'сеть недоступна'}`,
    };
  }
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || payload.error || !payload.access_token || !payload.refresh_token) {
    return {
      ok: false,
      error: payload.error_description
        ?? payload.error
        ?? `Яндекс отклонил обмен кода (${response.status})`,
    };
  }
  return {
    ok: true,
    tokens: {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + Math.max(Number(payload.expires_in) || 3_600, 60) * 1_000,
    },
  };
}
