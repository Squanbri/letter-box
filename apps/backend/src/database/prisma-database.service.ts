import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, PoolClient } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { postgresMigrations } from './postgres.migrations';

@Injectable()
export class PrismaDatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new ServiceUnavailableException(
        'DATABASE_URL обязателен для Prisma',
      );
    }
    this.pool = new Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 10_000,
    });
    const adapter = new PrismaPg(this.pool, { disposeExternalPool: true });
    this.client = new PrismaClient({ adapter });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.migrate();
      await this.client.$connect();
    } catch (error) {
      await this.pool.end();
      throw new ServiceUnavailableException(
        `Не удалось подготовить PostgreSQL: ${this.message(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  private async migrate(): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock($1)', [0x4c42584d]);
      await connection.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const applied = await connection.query<{ version: number }>(
        'SELECT version FROM schema_migrations',
      );
      const versions = new Set(applied.rows.map(({ version }) => version));
      for (const migration of postgresMigrations) {
        if (versions.has(migration.version)) continue;
        await connection.query(migration.sql);
        await connection.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name],
        );
      }
      await connection.query('COMMIT');
    } catch (error) {
      await this.rollback(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  private async rollback(connection: PoolClient): Promise<void> {
    await connection.query('ROLLBACK').catch(() => undefined);
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'неизвестная ошибка';
  }
}
