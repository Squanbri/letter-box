import type { AuthUser } from '@letter-box/contracts';
import type { StoredUser } from './auth.repository';

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

export type RegistrationResult =
  | { status: 'created'; user: AuthUser }
  | { status: 'email-exists' }
  | { status: 'disabled' };

export interface AuthRepositoryContract {
  count(): Promise<number>;
  findByEmail(email: string): Promise<StoredUser | undefined>;
  findById(id: string): Promise<AuthUser | undefined>;
  create(user: StoredUser, now: string): Promise<AuthUser>;
  claimUnownedAccounts(userId: string): Promise<void>;
  register(
    user: StoredUser,
    now: string,
    allowRegistration: boolean,
  ): Promise<RegistrationResult>;
  createSession(
    id: string,
    userId: string,
    tokenHash: string,
    expiresAt: string,
    createdAt: string,
  ): Promise<void>;
  rotateSession(
    currentHash: string,
    next: {
      id: string;
      tokenHash: string;
      expiresAt: string;
      createdAt: string;
    },
  ): Promise<AuthUser | undefined>;
  revokeSession(userId: string, tokenHash: string): Promise<void>;
}
