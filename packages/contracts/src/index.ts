export type MailProvider = 'mailru' | 'yandex' | 'gmail';
export type AccountConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'syncing'
  | 'error';

export interface AccountInput {
  provider: MailProvider;
  email: string;
  password: string;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface RefreshSessionInput {
  refreshToken: string;
}

export interface AccountStatus {
  id: string;
  email: string;
  provider: MailProvider;
  status: AccountConnectionStatus;
  lastError: string | null;
  lastSyncAt: string | null;
  unreadCount: number;
}

export interface MessageRecord {
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

export interface MailboxRecord {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  totalCount: number;
  unreadCount: number;
}

export interface SyncResult {
  synced: number;
  added: number;
  updated: number;
  removed: number;
}

export interface SyncStatus {
  mailboxes: string[];
}

export type ServerEvent =
  | { type: 'sync.started'; accountId: string; mailbox: string }
  | {
    type: 'sync.completed';
    accountId: string;
    mailbox: string;
    result: SyncResult;
  }
  | {
    type: 'sync.failed';
    accountId: string;
    mailbox: string;
    error: string;
  };
