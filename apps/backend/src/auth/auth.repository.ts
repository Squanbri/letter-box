import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@letter-box/contracts';
import { DatabaseService } from '../database/database.service';
import type { RegistrationResult } from './auth.contract';

export interface StoredUser extends AuthUser {
  passwordHash: string;
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async count(): Promise<number> {
    return (this.database.db.prepare(
      'SELECT COUNT(*) AS count FROM users',
    ).get() as { count: number }).count;
  }

  async findByEmail(email: string): Promise<StoredUser | undefined> {
    const row = this.database.db.prepare(
      'SELECT id, email, password_hash FROM users WHERE email = ?',
    ).get(email) as { id: string; email: string; password_hash: string } | undefined;
    return row && { id: row.id, email: row.email, passwordHash: row.password_hash };
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    return this.database.db.prepare(
      'SELECT id, email FROM users WHERE id = ?',
    ).get(id) as AuthUser | undefined;
  }

  async create(user: StoredUser, now: string): Promise<AuthUser> {
    this.database.db.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, user.email, user.passwordHash, now, now);
    return { id: user.id, email: user.email };
  }

  async claimUnownedAccounts(userId: string): Promise<void> {
    this.database.db.prepare(
      'UPDATE accounts SET user_id = ? WHERE user_id IS NULL',
    ).run(userId);
  }

  async register(
    user: StoredUser,
    now: string,
    allowRegistration: boolean,
  ): Promise<RegistrationResult> {
    return this.database.db.transaction(() => {
      if (this.database.db.prepare(
        'SELECT 1 FROM users WHERE email = ?',
      ).get(user.email)) return { status: 'email-exists' } as const;
      const count = (this.database.db.prepare(
        'SELECT COUNT(*) AS count FROM users',
      ).get() as { count: number }).count;
      if (count > 0 && !allowRegistration) return { status: 'disabled' } as const;
      this.database.db.prepare(`
        INSERT INTO users (id, email, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(user.id, user.email, user.passwordHash, now, now);
      if (count === 0) {
        this.database.db.prepare(
          'UPDATE accounts SET user_id = ? WHERE user_id IS NULL',
        ).run(user.id);
      }
      return {
        status: 'created',
        user: { id: user.id, email: user.email },
      } as const;
    })();
  }

  async createSession(
    id: string,
    userId: string,
    tokenHash: string,
    expiresAt: string,
    createdAt: string,
  ): Promise<void> {
    this.database.db.prepare(`
      INSERT INTO auth_sessions (
        id, user_id, token_hash, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, tokenHash, expiresAt, createdAt);
  }

  async rotateSession(
    currentHash: string,
    next: {
      id: string;
      tokenHash: string;
      expiresAt: string;
      createdAt: string;
    },
  ): Promise<AuthUser | undefined> {
    return this.database.db.transaction(() => {
      const row = this.database.db.prepare(`
        SELECT users.id, users.email
        FROM auth_sessions
        JOIN users ON users.id = auth_sessions.user_id
        WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?
      `).get(currentHash, next.createdAt) as AuthUser | undefined;
      if (!row) return undefined;
      this.database.db.prepare(
        'DELETE FROM auth_sessions WHERE token_hash = ?',
      ).run(currentHash);
      this.database.db.prepare(`
        INSERT INTO auth_sessions (
          id, user_id, token_hash, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(next.id, row.id, next.tokenHash, next.expiresAt, next.createdAt);
      return row;
    })();
  }

  async revokeSession(userId: string, tokenHash: string): Promise<void> {
    this.database.db.prepare(
      'DELETE FROM auth_sessions WHERE user_id = ? AND token_hash = ?',
    ).run(userId, tokenHash);
  }
}
