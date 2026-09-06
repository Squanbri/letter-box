export interface AccountConfig {
  id: string;
  provider: 'mailru' | 'yandex' | 'gmail' | 'imap';
  email: string;
  authType: 'oauth' | 'basic';
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  host: string;
  port: number;
  secure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export interface CredentialStore {
  loadAll(): Promise<AccountConfig[]>;
  save(account: AccountConfig): Promise<void>;
  delete(accountId: string): Promise<void>;
}

export interface ApiHandle {
  url: string;
  close(): Promise<void>;
}

export function startApi(options?: {
  port?: number;
  databasePath?: string;
  credentialStore?: CredentialStore;
}): Promise<ApiHandle>;
