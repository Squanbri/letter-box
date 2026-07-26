const API_URL = new URLSearchParams(window.location.search).get('api')
  ?? 'http://127.0.0.1:3000';

export interface AccountStatus {
  id: string;
  email: string;
  provider: 'mailru' | 'yandex';
  status: 'connected' | 'disconnected' | 'syncing' | 'error';
  lastError: string | null;
  lastSyncAt: string | null;
  unreadCount: number;
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

export interface SyncResult {
  synced: number;
  added: number;
  updated: number;
  removed: number;
}

export interface MailboxInfo {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  totalCount: number;
  unreadCount: number;
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
  sync: (id: string, mailbox = 'INBOX') =>
    request<SyncResult>(
      `${accountPath(id)}/mail/sync?mailbox=${encodeURIComponent(mailbox)}`,
      { method: 'POST' },
    ),
  mailboxes: (id: string) => request<MailboxInfo[]>(`${accountPath(id)}/mailboxes`),
  syncMailboxes: (id: string) =>
    request<MailboxInfo[]>(`${accountPath(id)}/mailboxes/sync`, { method: 'POST' }),
  messages: (id: string, mailbox = 'INBOX', offset = 0, limit = 50) =>
    request<Message[]>(
      `${accountPath(id)}/messages?mailbox=${encodeURIComponent(mailbox)}&offset=${offset}&limit=${limit}`,
    ),
  loadOlder: (id: string, mailbox: string, beforeUid?: number) =>
    request<{ loaded: number }>(
      `${accountPath(id)}/mail/load-older?mailbox=${encodeURIComponent(mailbox)}${beforeUid ? `&beforeUid=${beforeUid}` : ''}`,
      { method: 'POST' },
    ),
  message: (id: string, uid: number, mailbox = 'INBOX') =>
    request<Message>(
      `${accountPath(id)}/messages/${uid}?mailbox=${encodeURIComponent(mailbox)}`,
    ),
  setSeen: (id: string, uid: number, seen: boolean, mailbox = 'INBOX') =>
    request<Message>(
      `${accountPath(id)}/messages/${uid}/seen?mailbox=${encodeURIComponent(mailbox)}`,
      json('PATCH', { seen }),
    ),
  setFlagged: (id: string, uid: number, flagged: boolean, mailbox = 'INBOX') =>
    request<Message>(
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
