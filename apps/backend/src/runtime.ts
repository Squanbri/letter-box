import type { AccountAuthType, MailProvider } from '@letter-box/contracts';

export interface AccountConfig {
  id: string;
  provider: MailProvider;
  email: string;
  authType: AccountAuthType;
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

export interface RuntimeOptions {
  credentialStore?: CredentialStore;
}

let runtimeOptions: RuntimeOptions = {};

export function configureRuntime(options: RuntimeOptions): void {
  runtimeOptions = options;
}

export function getRuntimeOptions(): RuntimeOptions {
  return runtimeOptions;
}
