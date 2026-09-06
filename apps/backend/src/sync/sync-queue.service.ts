import {
  BadGatewayException,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Job, Queue, QueueEvents } from 'bullmq';
import type {
  BackfillResult,
  SyncResult,
  SyncStatus,
} from '@letter-box/contracts';
import {
  MAIL_REPOSITORY,
  MailRepositoryContract,
} from '../database/repository.contracts';
import { EventsGateway } from '../events/events.gateway';
import {
  BACKFILL_COMPLETE_UID,
  BACKFILL_JOB,
  MailboxJobData,
  MailboxJobResult,
  SYNC_JOB,
  SYNC_QUEUE_NAME,
  SyncJobResult,
} from './sync-queue.types';

@Injectable()
export class SyncQueueService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue<MailboxJobData, MailboxJobResult>;
  private events?: QueueEvents;
  private readonly activeJobs = new Map<string, { name: string; data: MailboxJobData }>();

  constructor(
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
    @Inject(MAIL_REPOSITORY) private readonly mail: MailRepositoryContract,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = this.connection();
    this.queue = new Queue<MailboxJobData, MailboxJobResult>(
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
      void this.publishCompleted(jobId, returnvalue);
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
      SYNC_JOB,
      { accountId, mailbox },
      { jobId: this.syncJobId(accountId, mailbox) },
    );
    try {
      return await job.waitUntilFinished(this.events, 20 * 60 * 1_000) as SyncResult;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Неизвестная ошибка sync worker';
      throw new BadGatewayException(message);
    }
  }

  /** Fire-and-forget incremental sync (used after account connect). */
  async enqueueSync(
    accountId: string,
    mailbox: string,
  ): Promise<{ queued: true }> {
    if (!this.queue) {
      throw new ServiceUnavailableException('Очередь синхронизации недоступна');
    }
    await this.queue.add(
      SYNC_JOB,
      { accountId, mailbox },
      { jobId: this.syncJobId(accountId, mailbox) },
    );
    return { queued: true };
  }

  /**
   * Fire-and-forget history backfill. Deduped per folder via stable jobId.
   * No-ops when Folder.backfilledUid is already the complete sentinel (unless force).
   */
  async enqueueBackfill(
    accountId: string,
    mailbox: string,
    options: { force?: boolean } = {},
  ): Promise<{ queued: boolean }> {
    if (!this.queue) {
      throw new ServiceUnavailableException('Очередь синхронизации недоступна');
    }
    if (!options.force) {
      const cursor = await this.mail.folderCursor(accountId, mailbox);
      if (cursor?.backfilledUid === BACKFILL_COMPLETE_UID) {
        return { queued: false };
      }
    }
    await this.queue.add(
      BACKFILL_JOB,
      { accountId, mailbox, force: options.force },
      { jobId: this.backfillJobId(accountId, mailbox) },
    );
    return { queued: true };
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
    const syncing = new Set<string>();
    const backfilling = new Set<string>();
    for (const job of jobs) {
      if (job.data.accountId !== accountId) continue;
      if (job.name === BACKFILL_JOB) backfilling.add(job.data.mailbox);
      else syncing.add(job.data.mailbox);
    }
    return {
      mailboxes: [...syncing],
      backfilling: [...backfilling],
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

  private syncJobId(accountId: string, mailbox: string): string {
    return createHash('sha256')
      .update(`sync\0${accountId}\0${mailbox}`)
      .digest('base64url');
  }

  private backfillJobId(accountId: string, mailbox: string): string {
    return createHash('sha256')
      .update(`backfill\0${accountId}\0${mailbox}`)
      .digest('base64url');
  }

  private async getJob(jobId: string): Promise<Job<MailboxJobData> | undefined> {
    return this.queue?.getJob(jobId);
  }

  private async publishStarted(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;
    this.activeJobs.set(jobId, { name: job.name, data: job.data });
    if (job.name === BACKFILL_JOB) {
      this.gateway.publish({ type: 'backfill.started', ...job.data });
      return;
    }
    this.gateway.publish({ type: 'sync.started', ...job.data });
  }

  private async publishCompleted(
    jobId: string,
    returnvalue: string | MailboxJobResult,
  ): Promise<void> {
    const tracked = this.activeJobs.get(jobId) ?? await this.lookupActive(jobId);
    this.activeJobs.delete(jobId);
    if (!tracked) return;
    if (tracked.name === BACKFILL_JOB) {
      this.gateway.publish({
        type: 'backfill.completed',
        ...tracked.data,
        result: this.parseBackfillResult(returnvalue),
      });
      return;
    }
    this.gateway.publish({
      type: 'sync.completed',
      ...tracked.data,
      result: this.parseSyncResult(returnvalue),
    });
  }

  private async publishFailed(jobId: string, error: string): Promise<void> {
    const tracked = this.activeJobs.get(jobId) ?? await this.lookupActive(jobId);
    this.activeJobs.delete(jobId);
    if (!tracked) return;
    if (tracked.name === BACKFILL_JOB) {
      this.gateway.publish({
        type: 'backfill.failed',
        ...tracked.data,
        error,
      });
      return;
    }
    this.gateway.publish({
      type: 'sync.failed',
      ...tracked.data,
      error,
    });
  }

  private async lookupActive(
    jobId: string,
  ): Promise<{ name: string; data: MailboxJobData } | undefined> {
    const job = await this.getJob(jobId);
    if (!job) return undefined;
    return { name: job.name, data: job.data };
  }

  private parseSyncResult(value: string | MailboxJobResult): SyncResult {
    if (typeof value !== 'string') return value as SyncJobResult;
    return JSON.parse(value) as SyncResult;
  }

  private parseBackfillResult(value: string | MailboxJobResult): BackfillResult {
    if (typeof value !== 'string') return value as BackfillResult;
    return JSON.parse(value) as BackfillResult;
  }
}
