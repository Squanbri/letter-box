import assert from 'node:assert/strict';
import test from 'node:test';
import { HealthController } from '../health.controller';
import type { PostgresDatabaseService } from '../database/postgres-database.service';
import type { SyncQueueService } from '../sync/sync-queue.service';

function controller(workers: number): HealthController {
  const database = {
    ping: async () => undefined,
  } as PostgresDatabaseService;
  const queue = {
    workerCount: async () => workers,
  } as SyncQueueService;
  return new HealthController(database, queue);
}

test('reports API liveness without probing dependencies', () => {
  assert.deepEqual(controller(0).live(), { status: 'ok' });
});

test('reports readiness when PostgreSQL, Redis, and a worker are available', async () => {
  assert.deepEqual(await controller(2).ready(), {
    status: 'ok',
    postgres: 'ok',
    redis: 'ok',
    syncWorkers: 2,
  });
});

test('rejects readiness when no sync worker is available', async () => {
  await assert.rejects(controller(0).ready(), /Нет доступных sync workers/);
});
