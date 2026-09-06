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
 * Cross-worker mutexes for IMAP sync.
 * - Folder lock: sync ↔ backfill must not race the same mailbox.
 * - Account lock: a new sync tick must not stack on an in-flight account sync.
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
    return this.withKey(this.folderKey(accountId, mailbox), run, true);
  }

  async withAccountLock<T>(
    accountId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    return this.withKey(this.accountKey(accountId), run, true);
  }

  /** Non-blocking check used by the scheduler to skip in-flight accounts. */
  async isAccountLocked(accountId: string): Promise<boolean> {
    const value = await this.redis().get(this.accountKey(accountId));
    return value !== null;
  }

  private async withKey<T>(
    key: string,
    run: () => Promise<T>,
    wait: boolean,
  ): Promise<T> {
    const redis = this.redis();
    const token = randomUUID();
    const acquired = wait
      ? await this.acquire(redis, key, token)
      : await this.tryAcquire(redis, key, token);
    if (!acquired) {
      throw new ServiceUnavailableException(
        'Синхронизация аккаунта/папки уже выполняется',
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

  private folderKey(accountId: string, mailbox: string): string {
    return `lock:mailbox:${accountId}:${mailbox}`;
  }

  private accountKey(accountId: string): string {
    return `lock:account-sync:${accountId}`;
  }

  private async tryAcquire(
    redis: Redis,
    key: string,
    token: string,
  ): Promise<boolean> {
    const ok = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    return ok === 'OK';
  }

  private async acquire(
    redis: Redis,
    key: string,
    token: string,
  ): Promise<boolean> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      if (await this.tryAcquire(redis, key, token)) return true;
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
