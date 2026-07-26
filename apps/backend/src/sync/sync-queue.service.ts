import {
  BadGatewayException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Job, Queue, QueueEvents } from 'bullmq';
import type { SyncResult, SyncStatus } from '@letter-box/contracts';
import { EventsGateway } from '../events/events.gateway';
import {
  SYNC_QUEUE_NAME,
  SyncJobData,
  SyncJobResult,
} from './sync-queue.types';

@Injectable()
export class SyncQueueService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue<SyncJobData, SyncJobResult>;
  private events?: QueueEvents;
  private readonly activeJobs = new Map<string, SyncJobData>();

  constructor(private readonly gateway: EventsGateway) {}

  async onModuleInit(): Promise<void> {
    const connection = this.connection();
    this.queue = new Queue<SyncJobData, SyncJobResult>(
      SYNC_QUEUE_NAME,
      {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      },
    );
    this.events = new QueueEvents(SYNC_QUEUE_NAME, { connection });
    this.events.on('active', ({ jobId }) => {
      void this.publishStarted(jobId);
    });
    this.events.on('completed', ({ jobId, returnvalue }) => {
      void this.publishCompleted(jobId, this.parseResult(returnvalue));
    });
    this.events.on('failed', ({ jobId, failedReason }) => {
      void this.publishFailed(jobId, failedReason);
    });
    await Promise.all([this.queue.waitUntilReady(), this.events.waitUntilReady()]);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.events?.close(),
      this.queue?.close(),
    ]);
  }

  async enqueueAndWait(
    accountId: string,
    mailbox: string,
  ): Promise<SyncResult> {
    if (!this.queue || !this.events) {
      throw new ServiceUnavailableException('Очередь синхронизации недоступна');
    }
    const job = await this.queue.add(
      'sync',
      { accountId, mailbox },
      { jobId: this.jobId(accountId, mailbox) },
    );
    try {
      return await job.waitUntilFinished(this.events, 20 * 60 * 1_000);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Неизвестная ошибка sync worker';
      throw new BadGatewayException(message);
    }
  }

  async status(accountId: string): Promise<SyncStatus> {
    if (!this.queue) {
      throw new ServiceUnavailableException('Очередь синхронизации недоступна');
    }
    const jobs = await this.queue.getJobs(
      ['waiting', 'active', 'delayed'],
      0,
      999,
    );
    return {
      mailboxes: [...new Set(
        jobs
          .filter((job) => job.data.accountId === accountId)
          .map((job) => job.data.mailbox),
      )],
    };
  }

  async workerCount(): Promise<number> {
    if (!this.queue) {
      throw new ServiceUnavailableException('Очередь синхронизации недоступна');
    }
    return this.queue.getWorkersCount();
  }

  private connection(): { url: string } {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new ServiceUnavailableException(
        'REDIS_URL обязателен для очереди синхронизации',
      );
    }
    return { url };
  }

  private jobId(accountId: string, mailbox: string): string {
    return createHash('sha256')
      .update(`${accountId}\0${mailbox}`)
      .digest('base64url');
  }

  private async getJob(jobId: string): Promise<Job<SyncJobData> | undefined> {
    return this.queue?.getJob(jobId);
  }

  private async publishStarted(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;
    this.activeJobs.set(jobId, job.data);
    this.gateway.publish({ type: 'sync.started', ...job.data });
  }

  private async publishCompleted(
    jobId: string,
    result: SyncResult,
  ): Promise<void> {
    const data = this.activeJobs.get(jobId) ?? (await this.getJob(jobId))?.data;
    this.activeJobs.delete(jobId);
    if (!data) return;
    this.gateway.publish({
      type: 'sync.completed',
      ...data,
      result,
    });
  }

  private async publishFailed(jobId: string, error: string): Promise<void> {
    const data = this.activeJobs.get(jobId) ?? (await this.getJob(jobId))?.data;
    this.activeJobs.delete(jobId);
    if (!data) return;
    this.gateway.publish({
      type: 'sync.failed',
      ...data,
      error,
    });
  }

  private parseResult(value: string): SyncResult {
    return JSON.parse(value) as SyncResult;
  }
}
