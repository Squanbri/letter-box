import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  TOKEN_REFRESH_JOB,
  TOKEN_REFRESH_QUEUE_NAME,
} from './sync-queue.types';

const EVERY_FIVE_MINUTES = 5 * 60 * 1_000;

@Injectable()
export class TokenRefreshQueueService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue;

  async onModuleInit(): Promise<void> {
    const connection = this.connection();
    this.queue = new Queue(TOKEN_REFRESH_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: 20,
      },
    });
    await this.queue.waitUntilReady();
    await this.queue.add(
      TOKEN_REFRESH_JOB,
      {},
      {
        jobId: TOKEN_REFRESH_JOB,
        repeat: { every: EVERY_FIVE_MINUTES },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private connection(): { url: string } {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new ServiceUnavailableException(
        'REDIS_URL обязателен для очереди обновления токенов',
      );
    }
    return { url };
  }
}
