export interface AccountConfig {
  provider: 'mailru' | 'yandex';
  email: string;
  password: string;
  host: string;
  port: number;
  secure: boolean;
}

export interface CredentialStore {
  load(): Promise<AccountConfig | null>;
  save(account: AccountConfig): Promise<void>;
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

