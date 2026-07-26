export interface AccountConfig {
  id: string;
  provider: 'mailru' | 'yandex' | 'gmail';
  email: string;
  password: string;
  host: string;
  port: number;
  secure: boolean;
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
