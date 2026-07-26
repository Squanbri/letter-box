import 'reflect-metadata';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import { importSqliteToPostgres } from '../database/sqlite-postgres.importer';

async function main(): Promise<void> {
  const sqlitePath = process.argv[2] ?? process.env.SQLITE_IMPORT_PATH;
  if (!sqlitePath) {
    throw new Error(
      'Pass the SQLite path as an argument or set SQLITE_IMPORT_PATH',
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const postgres = new PostgresDatabaseService();
  await postgres.onModuleInit();
  try {
    const result = await importSqliteToPostgres(sqlitePath, postgres);
    console.log(JSON.stringify({ imported: result }));
  } finally {
    await postgres.onModuleDestroy();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
