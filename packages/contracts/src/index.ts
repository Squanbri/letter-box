export type OAuthProviderId = 'gmail' | 'yandex' | 'mailru';
export type OAuthCapableProviderId = 'gmail' | 'yandex';
export type MailProvider = OAuthProviderId | 'imap';
export type AccountAuthType = 'oauth' | 'basic';
export type AccountConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'syncing'
  | 'error'
  | 'needs_reauth';

export interface BasicAccountInput {
  authType?: 'basic';
  provider: MailProvider;
  email: string;
  password: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  useSSL?: boolean;
}

export interface OAuthAccountInput {
  authType: 'oauth';
  provider: OAuthCapableProviderId;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type AccountInput = BasicAccountInput | OAuthAccountInput;

export type ProviderAuthMode = 'oauth-pkce' | 'oauth-manual-code' | 'basic';

export interface OAuthProviderDefaults {
  id: OAuthProviderId;
  label: string;
  authMode: ProviderAuthMode;
  domainMatchers: string[];
  authEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
  userInfoMethod?: 'GET' | 'POST';
  scope?: string;
  extraAuthParams?: Record<string, string>;
  redirectUri?: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export interface ResolvedOAuthProvider extends OAuthProviderDefaults {
  clientId: string;
  clientSecret?: string;
  authEndpoint: string;
  tokenEndpoint: string;
  scope: string;
}

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderDefaults> = {
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    authMode: 'oauth-pkce',
    domainMatchers: ['gmail.com', 'googlemail.com'],
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    userInfoMethod: 'GET',
    scope: 'https://mail.google.com/ openid email',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  yandex: {
    id: 'yandex',
    label: 'Яндекс',
    authMode: 'oauth-manual-code',
    domainMatchers: [
      'yandex.ru',
      'ya.ru',
      'yandex.com',
      'yandex.by',
      'yandex.kz',
      'yandex.ua',
    ],
    authEndpoint: 'https://oauth.yandex.ru/authorize',
    tokenEndpoint: 'https://oauth.yandex.ru/token',
    userInfoEndpoint: 'https://login.yandex.ru/info?format=json',
    userInfoMethod: 'GET',
    // mail:imap_full — чтение/удаление писем; mail:smtp — отправка.
    scope: 'mail:imap_full mail:smtp',
    extraAuthParams: { force_confirm: 'yes' },
    redirectUri: 'https://oauth.yandex.ru/verification_code',
    imapHost: 'imap.yandex.ru',
    imapPort: 993,
    smtpHost: 'smtp.yandex.ru',
    smtpPort: 587,
    smtpSecure: false,
  },
  mailru: {
    id: 'mailru',
    label: 'Mail.ru',
    authMode: 'basic',
    domainMatchers: [
      'mail.ru',
      'inbox.ru',
      'list.ru',
      'bk.ru',
      'internet.ru',
      'mail.ua',
      'inbox.ua',
      'list.ua',
      'bk.ua',
    ],
    imapHost: 'imap.mail.ru',
    imapPort: 993,
    smtpHost: 'smtp.mail.ru',
    smtpPort: 587,
    smtpSecure: false,
  },
};

export function matchOAuthProvider(email: string): OAuthProviderId | null {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain) return null;
  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    if (provider.domainMatchers.some((matcher) => domainMatches(domain, matcher))) {
      return provider.id;
    }
  }
  return null;
}

export function resolveOAuthProvider(
  id: OAuthProviderId,
  env: Record<string, string | undefined> = process.env,
): ResolvedOAuthProvider {
  const defaults = OAUTH_PROVIDERS[id];
  if (defaults.authMode === 'basic') {
    throw new Error('Mail.ru подключается паролем приложения, без OAuth');
  }
  if (!defaults.authEndpoint || !defaults.tokenEndpoint || !defaults.scope) {
    throw new Error(`У провайдера ${id} нет OAuth-конфига`);
  }
  const prefix = `OAUTH_${id.toUpperCase()}`;
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim() ?? '';
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim() || undefined;
  if (!clientId) {
    throw new Error(
      `Не задан ${prefix}_CLIENT_ID. Добавьте shared OAuth client в .env`,
    );
  }
  return {
    ...defaults,
    clientId,
    clientSecret,
    authEndpoint: defaults.authEndpoint,
    tokenEndpoint: defaults.tokenEndpoint,
    scope: defaults.scope,
  };
}

function domainMatches(domain: string, matcher: string): boolean {
  return domain === matcher || domain.endsWith(`.${matcher}`);
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
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  threadId: string | null;
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

export interface TagAccountCount {
  tag: string;
  accountId: string;
  count: number;
  unreadCount: number;
}

export interface AwaitingReplyItem {
  accountId: string;
  mailbox: string;
  uid: number;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  date: string;
  daysWaiting: number;
}

export interface DashboardStats {
  messagesByDay: Array<{ date: string; count: number }>;
  messagesByDayByAccount: Array<{
    accountId: string;
    email: string;
    days: Array<{ date: string; count: number }>;
  }>;
  messagesByTag: Array<{ tag: string; count: number }>;
  unreadByTag: Array<{ tag: string; count: number }>;
  /** Matrix cells for tag × account on the dashboard. */
  tagAccountMatrix: TagAccountCount[];
  awaitingReply: AwaitingReplyItem[];
  classifiedCount: number;
  totalCount: number;
}

export const MESSAGE_TAGS = [
  'important',
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
  important: 'Важные',
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
