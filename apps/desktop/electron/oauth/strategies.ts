import type { ResolvedOAuthProvider } from '@letter-box/contracts';
import { runOAuthLoopbackFlow, OAuthCancelledError } from './loopback';
import type { AuthResult, AuthStrategy } from './types';

export class OAuthPkceStrategy implements AuthStrategy {
  private cancelFlow: (() => void) | null = null;

  constructor(private readonly config: ResolvedOAuthProvider) {}

  async authenticate(): Promise<AuthResult> {
    const flow = runOAuthLoopbackFlow(this.config);
    this.cancelFlow = flow.cancel;
    try {
      const tokens = await flow.promise;
      const email = await fetchProviderEmail(this.config, tokens.accessToken);
      return {
        type: 'oauth',
        email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      };
    } finally {
      this.cancelFlow = null;
    }
  }

  cancel(): void {
    this.cancelFlow?.();
  }
}

export class BasicAuthStrategy implements AuthStrategy {
  constructor(
    private readonly input: {
      email: string;
      password: string;
    },
  ) {}

  async authenticate(): Promise<AuthResult> {
    const email = this.input.email.trim().toLowerCase();
    const password = this.input.password.trim();
    if (!email || !password) {
      throw new Error('Укажите email и пароль приложения');
    }
    return { type: 'basic', email, password };
  }
}

export async function fetchProviderEmail(
  config: ResolvedOAuthProvider,
  accessToken: string,
): Promise<string> {
  if (!config.userInfoEndpoint) {
    throw new Error('Нет userinfo endpoint у провайдера');
  }
  const response = await fetch(config.userInfoEndpoint, {
    method: config.userInfoMethod ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const payload = await response.json().catch(() => ({})) as {
    email?: string;
    default_email?: string;
    login?: string;
  };
  if (!response.ok) {
    throw new Error('Не удалось получить email после OAuth');
  }
  const email = (payload.email ?? payload.default_email ?? payload.login ?? '').trim().toLowerCase();
  if (!email) throw new Error('Провайдер не вернул email аккаунта');
  if (!email.includes('@') && config.id === 'yandex') {
    return `${email}@yandex.ru`;
  }
  return email;
}

export function isCancelled(error: unknown): error is OAuthCancelledError {
  return error instanceof OAuthCancelledError;
}
