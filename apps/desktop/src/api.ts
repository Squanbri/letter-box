import type {
  AccountInput,
  AccountStatus,
  AuthCredentials,
  AuthSession,
  MailboxRecord,
  MessageRecord,
  SyncResult,
  SyncStatus,
} from '@letter-box/contracts';
import type { ServerEvent } from '@letter-box/contracts';
import { io } from 'socket.io-client';

export type {
  AccountInput,
  AccountStatus,
  AuthSession,
  MailboxRecord as MailboxInfo,
  MessageRecord as Message,
  SyncResult,
} from '@letter-box/contracts';

const API_URL = new URLSearchParams(window.location.search).get('api')
  ?? 'http://127.0.0.1:3000';
const API_PREFIX = '/api/v1';
let refreshPromise: Promise<AuthSession> | null = null;
let authSession: AuthSession | null = null;

export function readAuthSession(): AuthSession | null {
  return authSession;
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  if (!window.letterBoxSession) return null;
  try {
    const stored = await window.letterBoxSession.load();
    authSession = stored ? JSON.parse(stored) as AuthSession : null;
  } catch {
    authSession = null;
  }
  return authSession;
}

export async function clearAuthSession(): Promise<void> {
  authSession = null;
  await window.letterBoxSession?.clear();
}

async function saveAuthSession(session: AuthSession): Promise<AuthSession> {
  authSession = session;
  if (!window.letterBoxSession) {
    throw new Error('Secure session storage недоступно');
  }
  await window.letterBoxSession.save(JSON.stringify(session));
  return session;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  allowRefresh = true,
): Promise<T> {
  const token = readAuthSession()?.accessToken;
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${API_PREFIX}${path}`, { ...init, headers });
  if (response.status === 401 && token && allowRefresh) {
    try {
      await refreshAuthSession();
      return request<T>(path, init, false);
    } catch {
      void clearAuthSession();
      window.dispatchEvent(new Event('letter-box:unauthorized'));
    }
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message;
    throw new Error(message ?? `Ошибка API: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function refreshAuthSession(): Promise<AuthSession> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = readAuthSession()?.refreshToken;
  if (!refreshToken) throw new Error('Refresh token отсутствует');
  refreshPromise = fetch(`${API_URL}${API_PREFIX}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }).then(async (response) => {
    if (!response.ok) throw new Error('Не удалось обновить сессию');
    const session = await saveAuthSession(await response.json() as AuthSession);
    window.dispatchEvent(new Event('letter-box:auth-refreshed'));
    return session;
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const accountPath = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;

export const api = {
  register: (input: AuthCredentials) =>
    request<AuthSession>('/auth/register', json('POST', input)).then(saveAuthSession),
  login: (input: AuthCredentials) =>
    request<AuthSession>('/auth/login', json('POST', input)).then(saveAuthSession),
  logout: () => {
    const refreshToken = readAuthSession()?.refreshToken;
    return request<void>('/auth/logout', json('POST', { refreshToken }), false);
  },
  reportError: (message: string, stack?: string) => request<{ logged: true }>(
    '/diagnostics/log',
    json('POST', { level: 'error', message, stack }),
  ),
  accounts: () => request<AccountStatus[]>('/accounts'),
  addAccount: (input: AccountInput) => request<AccountStatus>('/accounts', json('POST', input)),
  reconnectAccount: (id: string, input: AccountInput) =>
    request<AccountStatus>(accountPath(id), json('PUT', input)),
  deleteAccount: (id: string) =>
    request<{ deleted: true }>(accountPath(id), { method: 'DELETE' }),
  connect: (id: string) =>
    request<{ connected: true }>(`${accountPath(id)}/imap/connect`, { method: 'POST' }),
  sync: (id: string, mailbox = 'INBOX') =>
    request<SyncResult>(
      `${accountPath(id)}/mail/sync?mailbox=${encodeURIComponent(mailbox)}`,
      { method: 'POST' },
    ),
  syncStatus: (id: string) =>
    request<SyncStatus>(`${accountPath(id)}/mail/sync`),
  mailboxes: (id: string) => request<MailboxRecord[]>(`${accountPath(id)}/mailboxes`),
  syncMailboxes: (id: string) =>
    request<MailboxRecord[]>(`${accountPath(id)}/mailboxes/sync`, { method: 'POST' }),
  messages: (id: string, mailbox = 'INBOX', offset = 0, limit = 50) =>
    request<MessageRecord[]>(
      `${accountPath(id)}/messages?mailbox=${encodeURIComponent(mailbox)}&offset=${offset}&limit=${limit}`,
    ),
  loadOlder: (id: string, mailbox: string, beforeUid?: number) =>
    request<{ loaded: number }>(
      `${accountPath(id)}/mail/load-older?mailbox=${encodeURIComponent(mailbox)}${beforeUid ? `&beforeUid=${beforeUid}` : ''}`,
      { method: 'POST' },
    ),
  message: (id: string, uid: number, mailbox = 'INBOX') =>
    request<MessageRecord>(
      `${accountPath(id)}/messages/${uid}?mailbox=${encodeURIComponent(mailbox)}`,
    ),
  setSeen: (id: string, uid: number, seen: boolean, mailbox = 'INBOX') =>
    request<MessageRecord>(
      `${accountPath(id)}/messages/${uid}/seen?mailbox=${encodeURIComponent(mailbox)}`,
      json('PATCH', { seen }),
    ),
  setFlagged: (id: string, uid: number, flagged: boolean, mailbox = 'INBOX') =>
    request<MessageRecord>(
      `${accountPath(id)}/messages/${uid}/flagged?mailbox=${encodeURIComponent(mailbox)}`,
      json('PATCH', { flagged }),
    ),
  moveMessage: (id: string, uid: number, mailbox: string, destination: string) =>
    request<{ moved: true }>(
      `${accountPath(id)}/messages/${uid}/move?mailbox=${encodeURIComponent(mailbox)}`,
      json('POST', { destination }),
    ),
  archiveMessage: (id: string, uid: number, mailbox: string) =>
    request<{ moved: true }>(
      `${accountPath(id)}/messages/${uid}/archive?mailbox=${encodeURIComponent(mailbox)}`,
      { method: 'POST' },
    ),
  deleteMessage: (id: string, uid: number, mailbox: string) =>
    request<{ deleted: true }>(
      `${accountPath(id)}/messages/${uid}?mailbox=${encodeURIComponent(mailbox)}`,
      { method: 'DELETE' },
    ),
};

export function subscribeToServerEvents(
  listener: (event: ServerEvent) => void,
  connected?: () => void,
): () => void {
  const socket = io(API_URL, {
    transports: ['websocket'],
    reconnection: true,
    auth: { token: readAuthSession()?.accessToken },
  });
  const refreshSocketAuth = () => {
    socket.auth = { token: readAuthSession()?.accessToken };
    socket.disconnect().connect();
  };
  window.addEventListener('letter-box:auth-refreshed', refreshSocketAuth);
  socket.on('server.event', listener);
  if (connected) socket.on('connect', connected);
  return () => {
    window.removeEventListener('letter-box:auth-refreshed', refreshSocketAuth);
    socket.disconnect();
  };
}
