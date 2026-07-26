const API_URL = new URLSearchParams(window.location.search).get('api')
  ?? 'http://127.0.0.1:3000';

export interface AccountStatus {
  id: string;
  email: string;
  provider: 'mailru' | 'yandex';
  status: 'connected' | 'disconnected' | 'syncing' | 'error';
  lastError: string | null;
  lastSyncAt: string | null;
}

export interface AccountInput {
  provider: 'mailru' | 'yandex';
  email: string;
  password: string;
}

export interface Message {
  accountId: string;
  mailbox: string;
  uid: number;
  subject: string | null;
  from: { name: string | null; address: string | null };
  date: string;
  flags: string[];
  size: number;
  body: { text: string | null; html: string | null } | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message;
    throw new Error(message ?? `Ошибка API: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const accountPath = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;

export const api = {
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
  sync: (id: string) =>
    request<{ synced: number }>(`${accountPath(id)}/mail/sync`, { method: 'POST' }),
  messages: (id: string, mailbox = 'INBOX') =>
    request<Message[]>(`${accountPath(id)}/messages?mailbox=${encodeURIComponent(mailbox)}`),
  message: (id: string, uid: number, mailbox = 'INBOX') =>
    request<Message>(
      `${accountPath(id)}/messages/${uid}?mailbox=${encodeURIComponent(mailbox)}`,
    ),
};
