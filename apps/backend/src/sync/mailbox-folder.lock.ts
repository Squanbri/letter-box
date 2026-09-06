import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

const LOCK_TTL_MS = 120_000;
const LOCK_WAIT_MS = 90_000;
const LOCK_RETRY_MS = 250;

/**
 * Cross-worker mutex for one IMAP folder.
 * Sync and backfill must not run concurrently on the same (account, mailbox):
 * incremental applyChanges prunes against full server UID set and both open
 * an IMAP mailbox lock on separate connections.
 */
@Injectable()
export class MailboxFolderLock implements OnModuleDestroy {
  private client?: Redis;

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
    this.client = undefined;
  }

  async withLock<T>(
    accountId: string,
    mailbox: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const redis = this.redis();
    const key = this.key(accountId, mailbox);
    const token = randomUUID();
    const acquired = await this.acquire(redis, key, token);
    if (!acquired) {
      throw new ServiceUnavailableException(
        `Папка ${mailbox} уже синхронизируется`,
      );
    }
    try {
      return await run();
    } finally {
      await this.release(redis, key, token);
    }
  }

  private redis(): Redis {
    if (this.client) return this.client;
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new ServiceUnavailableException(
        'REDIS_URL обязателен для блокировки папок',
      );
    }
    this.client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    return this.client;
  }

  private key(accountId: string, mailbox: string): string {
    return `lock:mailbox:${accountId}:${mailbox}`;
  }

  private async acquire(
    redis: Redis,
    key: string,
    token: string,
  ): Promise<boolean> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      const ok = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
      if (ok === 'OK') return true;
      await sleep(LOCK_RETRY_MS);
    }
    return false;
  }

  private async release(
    redis: Redis,
    key: string,
    token: string,
  ): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
    `;
    await redis.eval(script, 1, key, token);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
