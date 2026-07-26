import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { postgresMigrations } from './postgres.migrations';

@Injectable()
export class PostgresDatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;

  async onModuleInit(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new ServiceUnavailableException(
        'DATABASE_URL обязателен: PostgreSQL является серверным источником данных',
      );
    }

    this.pool = new Pool({ connectionString, max: 10 });
    this.pool.on('error', (error) => {
      console.error('Unexpected PostgreSQL pool error', error);
    });
    try {
      await this.migrate();
    } catch (error) {
      await this.pool.end();
      this.pool = undefined;
      throw new ServiceUnavailableException(
        `Не удалось подготовить PostgreSQL: ${this.message(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  get enabled(): boolean {
    return Boolean(this.pool);
  }

  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Row>> {
    if (!this.pool) {
      throw new ServiceUnavailableException('PostgreSQL не настроен');
    }
    return this.pool.query<Row>(text, values);
  }

  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new ServiceUnavailableException('PostgreSQL не настроен');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async migrate(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [0x4c42584d]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      const applied = await client.query<{ version: number }>(
        'SELECT version FROM schema_migrations',
      );
      const versions = new Set(applied.rows.map((row) => row.version));
      for (const migration of postgresMigrations) {
        if (versions.has(migration.version)) continue;
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name],
        );
      }
    });
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'неизвестная ошибка';
  }
}
