import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, RedisClientType } from 'redis';

export interface SyncLease {
  key: string;
  token: string;
}

@Injectable()
export class SyncLockService implements OnModuleInit, OnModuleDestroy {
  private client?: RedisClientType;
  private readonly renewals = new Map<string, NodeJS.Timeout>();

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) return;

    this.client = createClient({ url });
    this.client.on('error', (error) => {
      console.error('Redis sync lock error', error);
    });
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    for (const renewal of this.renewals.values()) clearInterval(renewal);
    this.renewals.clear();
    if (this.client?.isOpen) await this.client.quit();
  }

  async acquire(accountId: string, mailbox: string): Promise<SyncLease | null> {
    const lease = {
      key: `letter-box:sync:${encodeURIComponent(accountId)}:${encodeURIComponent(mailbox)}`,
      token: randomUUID(),
    };
    if (!this.client) return lease;

    try {
      const result = await this.client.set(lease.key, lease.token, {
        NX: true,
        PX: 15 * 60 * 1000,
      });
      if (result !== 'OK') return null;
      this.startRenewal(lease);
      return lease;
    } catch {
      throw new ServiceUnavailableException('Redis недоступен: синхронизация временно отключена');
    }
  }

  async release(lease: SyncLease): Promise<void> {
    const renewal = this.renewals.get(lease.token);
    if (renewal) clearInterval(renewal);
    this.renewals.delete(lease.token);
    if (!this.client) return;
    try {
      await this.client.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1]
         then return redis.call("del", KEYS[1])
         else return 0 end`,
        { keys: [lease.key], arguments: [lease.token] },
      );
    } catch (error) {
      console.error('Redis sync lock release failed', error);
    }
  }

  private startRenewal(lease: SyncLease): void {
    const renewal = setInterval(() => {
      void this.client?.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1]
         then return redis.call("pexpire", KEYS[1], ARGV[2])
         else return 0 end`,
        {
          keys: [lease.key],
          arguments: [lease.token, String(15 * 60 * 1000)],
        },
      ).catch((error) => console.error('Redis sync lock renewal failed', error));
    }, 5 * 60 * 1000);
    renewal.unref();
    this.renewals.set(lease.token, renewal);
  }
}
