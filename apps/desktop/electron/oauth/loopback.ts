import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { shell } from 'electron';
import type { ResolvedOAuthProvider } from '@letter-box/contracts';
import { interpretOAuthCallback } from './callback';
import { generatePkce, randomOAuthState } from './pkce';
import type { TokenResult } from './types';

const FLOW_TIMEOUT_MS = 5 * 60 * 1_000;

export class OAuthCancelledError extends Error {
  constructor() {
    super('Авторизация в браузере отменена');
    this.name = 'OAuthCancelledError';
  }
}

export function runOAuthLoopbackFlow(
  config: ResolvedOAuthProvider,
): { promise: Promise<TokenResult>; cancel: () => void } {
  let server: Server | undefined;
  let settled = false;
  let cancelFn = (): void => undefined;

  const promise = new Promise<TokenResult>((resolve, reject) => {
    const { verifier, challenge } = generatePkce();
    const state = randomOAuthState();
    server = createServer();
    const timer = setTimeout(() => {
      finish(new Error('Истекло время ожидания подтверждения в браузере'));
    }, FLOW_TIMEOUT_MS);
    timer.unref();

    const finish = (error?: unknown, tokens?: TokenResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server?.close();
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else if (tokens) resolve(tokens);
    };

    cancelFn = () => finish(new OAuthCancelledError());

    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
      }
      const parsed = interpretOAuthCallback(request.url ?? '/', state);
      const ok = !('error' in parsed);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(callbackPage(ok));
      if (!ok) {
        finish(new Error(parsed.error));
        return;
      }
      const address = server?.address() as AddressInfo | null;
      const redirectUri = `http://127.0.0.1:${address?.port ?? 0}/`;
      void exchangeAuthorizationCode(config, parsed.code, verifier, redirectUri)
        .then((tokens) => finish(undefined, tokens))
        .catch((error: unknown) => finish(error));
    });

    server.on('error', (error) => finish(error));

    server.listen(Number(process.env.OAUTH_LOOPBACK_PORT ?? 0), '127.0.0.1', () => {
      const address = server?.address();
      if (!address || typeof address === 'string') {
        finish(new Error('Не удалось открыть loopback-порт 127.0.0.1'));
        return;
      }
      const redirectUri = `http://127.0.0.1:${address.port}/`;
      const authUrl = buildAuthUrl(config, redirectUri, state, challenge);
      void shell.openExternal(authUrl).catch((error: unknown) => finish(error));
    });
  });

  return {
    promise,
    cancel: () => cancelFn(),
  };
}

function buildAuthUrl(
  config: ResolvedOAuthProvider,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const url = new URL(config.authEndpoint);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [key, value] of Object.entries(config.extraAuthParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function exchangeAuthorizationCode(
  config: ResolvedOAuthProvider,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (config.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString('base64')}`;
  }
  let response: Response;
  try {
    response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers,
      body,
    });
  } catch (error) {
    throw new Error(
      `Не удалось обменять код на токен: ${error instanceof Error ? error.message : 'сеть недоступна'}`,
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
    throw new Error(
      payload.error_description
        ?? payload.error
        ?? `Провайдер отклонил обмен кода (${response.status})`,
    );
  }
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error('Провайдер не вернул access/refresh token. Проверьте scope и prompt=consent.');
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + Math.max(Number(payload.expires_in) || 3_600, 60) * 1_000,
  };
}

function callbackPage(ok: boolean): string {
  const title = ok ? 'Аккаунт подтверждён' : 'Не удалось войти';
  const text = ok
    ? 'Можно закрыть эту вкладку и вернуться в Letter Box.'
    : 'Закройте вкладку и повторите подключение в Letter Box.';
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font: 16px/1.45 -apple-system, BlinkMacSystemFont, sans-serif; margin: 0;
    min-height: 100vh; display: grid; place-items: center; background: #fbfaf7; color: #1c1913; }
  main { text-align: center; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 0; color: #6b6558; }
</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
}
