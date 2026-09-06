import assert from 'node:assert/strict';
import test from 'node:test';
import {
  syncBackoffBaseMs,
  syncBackoffMaxMs,
} from './sync-queue.types';

test('computes capped exponential sync backoff delays', () => {
  const previousBase = process.env.SYNC_BACKOFF_BASE_MS;
  const previousMax = process.env.SYNC_BACKOFF_MAX_MS;
  process.env.SYNC_BACKOFF_BASE_MS = '60000';
  process.env.SYNC_BACKOFF_MAX_MS = '480000';
  try {
    const delays = [1, 2, 3, 4, 5].map((failCount) =>
      Math.min(
        syncBackoffMaxMs(),
        syncBackoffBaseMs() * (2 ** Math.max(failCount - 1, 0)),
      ),
    );
    assert.deepEqual(delays, [60_000, 120_000, 240_000, 480_000, 480_000]);
  } finally {
    if (previousBase === undefined) delete process.env.SYNC_BACKOFF_BASE_MS;
    else process.env.SYNC_BACKOFF_BASE_MS = previousBase;
    if (previousMax === undefined) delete process.env.SYNC_BACKOFF_MAX_MS;
    else process.env.SYNC_BACKOFF_MAX_MS = previousMax;
  }
});
