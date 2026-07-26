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

export interface RuntimeOptions {
  databasePath?: string;
  credentialStore?: CredentialStore;
}

let runtimeOptions: RuntimeOptions = {};

export function configureRuntime(options: RuntimeOptions): void {
  runtimeOptions = options;
}

export function getRuntimeOptions(): RuntimeOptions {
  return runtimeOptions;
}
