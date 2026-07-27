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
  tags: string[];
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

export interface SendMessageInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}

export interface SendMessageResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  sentMailbox: string | null;
}

export interface SyncStatus {
  mailboxes: string[];
}

export interface DashboardStats {
  messagesByDay: Array<{ date: string; count: number }>;
  messagesByTag: Array<{ tag: string; count: number }>;
  unreadByTag: Array<{ tag: string; count: number }>;
}

export const MESSAGE_TAGS = [
  'spam',
  'promo',
  'work',
  'games',
  'news',
  'it',
  'personal',
  'finance',
  'other',
] as const;

export type MessageTag = (typeof MESSAGE_TAGS)[number];

export const MESSAGE_TAG_LABELS: Record<MessageTag, string> = {
  spam: 'Спам',
  promo: 'Акции',
  work: 'Работа',
  games: 'Игры',
  news: 'Новости',
  it: 'IT',
  personal: 'Личное',
  finance: 'Финансы',
  other: 'Другое',
};

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
  }
  | {
    type: 'classification.completed';
    accountId: string;
    mailbox: string;
    uid: number;
    tags: string[];
  };
