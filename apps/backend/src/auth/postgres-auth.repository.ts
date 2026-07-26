import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@letter-box/contracts';
import type { QueryResultRow } from 'pg';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import type { StoredUser } from './auth.repository';
import type { RegistrationResult } from './auth.contract';

@Injectable()
export class PostgresAuthRepository {
  constructor(
    @Inject(PostgresDatabaseService)
    private readonly database: PostgresDatabaseService,
  ) {}

  async count(): Promise<number> {
    const result = await this.database.query<{ count: number } & QueryResultRow>(
      'SELECT COUNT(*)::int AS count FROM users',
    );
    return result.rows[0].count;
  }

  async findByEmail(email: string): Promise<StoredUser | undefined> {
    const result = await this.database.query<{
      id: string;
      email: string;
      password_hash: string;
    } & QueryResultRow>(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email],
    );
    const row = result.rows[0];
    return row && { id: row.id, email: row.email, passwordHash: row.password_hash };
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const result = await this.database.query<AuthUser & QueryResultRow>(
      'SELECT id, email FROM users WHERE id = $1',
      [id],
    );
    return result.rows[0];
  }

  async create(user: StoredUser, now: string): Promise<AuthUser> {
    await this.database.query(`
      INSERT INTO users (id, email, password_hash, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $4)
    `, [user.id, user.email, user.passwordHash, now]);
    return { id: user.id, email: user.email };
  }

  async claimUnownedAccounts(userId: string): Promise<void> {
    await this.database.query(
      'UPDATE accounts SET user_id = $1 WHERE user_id IS NULL',
      [userId],
    );
  }

  async register(
    user: StoredUser,
    now: string,
    allowRegistration: boolean,
  ): Promise<RegistrationResult> {
    return this.database.transaction(async (client) => {
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      if ((await client.query(
        'SELECT 1 FROM users WHERE email = $1',
        [user.email],
      )).rowCount) return { status: 'email-exists' };
      const count = Number((await client.query(
        'SELECT COUNT(*) AS count FROM users',
      )).rows[0].count);
      if (count > 0 && !allowRegistration) return { status: 'disabled' };
      await client.query(`
        INSERT INTO users (id, email, password_hash, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $4)
      `, [user.id, user.email, user.passwordHash, now]);
      if (count === 0) {
        await client.query(
          'UPDATE accounts SET user_id = $1 WHERE user_id IS NULL',
          [user.id],
        );
      }
      return {
        status: 'created',
        user: { id: user.id, email: user.email },
      };
    });
  }

  async createSession(
    id: string,
    userId: string,
    tokenHash: string,
    expiresAt: string,
    createdAt: string,
  ): Promise<void> {
    await this.database.query(`
      INSERT INTO auth_sessions (
        id, user_id, token_hash, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5)
    `, [id, userId, tokenHash, expiresAt, createdAt]);
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
    return this.database.transaction(async (client) => {
      const result = await client.query<AuthUser & QueryResultRow>(`
        DELETE FROM auth_sessions
        USING users
        WHERE auth_sessions.token_hash = $1
          AND auth_sessions.expires_at > $2
          AND users.id = auth_sessions.user_id
        RETURNING users.id, users.email
      `, [currentHash, next.createdAt]);
      const user = result.rows[0];
      if (!user) return undefined;
      await client.query(`
        INSERT INTO auth_sessions (
          id, user_id, token_hash, expires_at, created_at
        ) VALUES ($1, $2, $3, $4, $5)
      `, [next.id, user.id, next.tokenHash, next.expiresAt, next.createdAt]);
      return user;
    });
  }

  async revokeSession(userId: string, tokenHash: string): Promise<void> {
    await this.database.query(
      'DELETE FROM auth_sessions WHERE user_id = $1 AND token_hash = $2',
      [userId, tokenHash],
    );
  }
}
