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

