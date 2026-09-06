import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import {
  TAG_MESSAGE_JOB,
  TAG_SWEEP_JOB,
  TAGGING_QUEUE_NAME,
  type TagMessageJobData,
  type TagMessageSource,
  type TaggingJobData,
  type TaggingJobResult,
  tagMaxAttempts,
  tagPriorityFor,
  tagSweepIntervalMs,
} from './tagging-queue.types';

@Injectable()
export class TaggingQueueService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue<TaggingJobData, TaggingJobResult>;

  async onModuleInit(): Promise<void> {
    const connection = this.connection();
    this.queue = new Queue<TaggingJobData, TaggingJobResult>(TAGGING_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: tagMaxAttempts(),
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    });
    await this.queue.waitUntilReady();
    await this.queue.add(
      TAG_SWEEP_JOB,
      {},
      {
        jobId: TAG_SWEEP_JOB,
        repeat: { every: tagSweepIntervalMs() },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  async enqueueTag(
    accountId: string,
    mailbox: string,
    uid: number,
    source: TagMessageSource,
  ): Promise<{ queued: boolean }> {
    if (!this.queue) {
      throw new ServiceUnavailableException('Очередь тегирования недоступна');
    }
    const data: TagMessageJobData = { accountId, mailbox, uid, source };
    try {
      await this.queue.add(TAG_MESSAGE_JOB, data, {
        jobId: this.jobId(accountId, mailbox, uid),
        priority: tagPriorityFor(source),
      });
      return { queued: true };
    } catch (error) {
      if (isDuplicateJobError(error)) return { queued: false };
      throw error;
    }
  }

  async enqueueMany(
    accountId: string,
    mailbox: string,
    uids: number[],
    source: TagMessageSource,
  ): Promise<number> {
    let queued = 0;
    for (const uid of uids) {
      const result = await this.enqueueTag(accountId, mailbox, uid, source);
      if (result.queued) queued += 1;
    }
    return queued;
  }

  private jobId(accountId: string, mailbox: string, uid: number): string {
    return createHash('sha256')
      .update(`tag\0${accountId}\0${mailbox}\0${uid}`)
      .digest('base64url');
  }

  private connection(): { url: string } {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new ServiceUnavailableException(
        'REDIS_URL обязателен для очереди тегирования',
      );
    }
    return { url };
  }
}

function isDuplicateJobError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|JobId/i.test(message);
}
