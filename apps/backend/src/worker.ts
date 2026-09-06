import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppModule } from './app.module';
import { AccountService } from './account/account.service';
import { FileCredentialStore } from './account/file-credential.store';
import { ClassificationService } from './ai/classification.service';
import { MailService } from './mail/mail.service';
import { TokenService } from './account/token.service';
import { configureRuntime } from './runtime';
import { SyncQueueService } from './sync/sync-queue.service';
import {
  BACKFILL_JOB,
  BackfillJobData,
  MailboxJobData,
  MailboxJobResult,
  SYNC_QUEUE_NAME,
  TOKEN_REFRESH_QUEUE_NAME,
  SyncJobData,
} from './sync/sync-queue.types';

async function startWorker(): Promise<void> {
  process.env.LETTER_BOX_PROCESS_ROLE = 'worker';
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL обязателен для sync worker');

  configureRuntime({ credentialStore: new FileCredentialStore() });
  const application = await NestFactory.createApplicationContext(AppModule);
  const accounts = application.get(AccountService);
  const mail = application.get(MailService);
  const classification = application.get(ClassificationService);
  const tokens = application.get(TokenService);
  const syncQueue = application.get(SyncQueueService);
  const worker = new Worker<MailboxJobData, MailboxJobResult>(
    SYNC_QUEUE_NAME,
    async (job) => {
      await accounts.reloadCredential(job.data.accountId);
      if (job.name === BACKFILL_JOB) {
        const data = job.data as BackfillJobData;
        return mail.backfillMailbox(data.accountId, data.mailbox, {
          force: data.force,
        });
      }
      const data = job.data as SyncJobData;
      const result = await mail.syncMailbox(data.accountId, data.mailbox);
      void classification.processBatch();
      // After incremental catch-up, kick off one-shot history if needed.
      void syncQueue.enqueueBackfill(data.accountId, data.mailbox).catch((error) => {
        console.error('[worker:backfill] enqueue failed', {
          accountId: data.accountId,
          mailbox: data.mailbox,
          error: error instanceof Error ? error.message : error,
        });
      });
      return result;
    },
    {
      connection: { url: redisUrl },
      concurrency: Number(process.env.SYNC_WORKER_CONCURRENCY ?? 4),
      // History walks can outlive the default 30s lock; BullMQ renews while processing.
      lockDuration: 120_000,
    },
  );

  worker.on('failed', (job, error) => {
    console.error(`[worker:${job?.name ?? 'sync'}] job failed`, {
      jobId: job?.id,
      accountId: job?.data.accountId,
      mailbox: job?.data.mailbox,
      attempt: job?.attemptsMade,
      error: error.message,
    });
  });
  worker.on('error', (error) => {
    console.error('[worker:sync] queue error', error);
  });
  await worker.waitUntilReady();
  console.info('[worker:sync] ready');

  const tokenWorker = new Worker(
    TOKEN_REFRESH_QUEUE_NAME,
    async () => {
      const refreshed = await tokens.refreshDue();
      if (refreshed > 0) {
        console.info(`[worker:oauth] refreshed ${refreshed} token(s)`);
      }
      return { refreshed };
    },
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );
  tokenWorker.on('failed', (_job, error) => {
    console.error('[worker:oauth] refresh failed', error.message);
  });
  tokenWorker.on('error', (error) => {
    console.error('[worker:oauth] queue error', error);
  });
  await tokenWorker.waitUntilReady();
  console.info('[worker:oauth] ready');

  const classifyIntervalMs = Math.max(
    Number(process.env.CLASSIFY_INTERVAL_MS ?? 300_000),
    5_000,
  );
  const runClassification = async (): Promise<void> => {
    try {
      const boosted = await classification.applyImportantHeuristics();
      if (boosted > 0) {
        console.info(`[worker:classify] boosted important on ${boosted} message(s)`);
      }
      let classified = 0;
      do {
        classified = await classification.processBatch();
        if (classified > 0) {
          console.info(`[worker:classify] classified ${classified} message(s)`);
        }
      } while (classified > 0);
    } catch (error) {
      console.error('[worker:classify] batch failed', error);
    }
  };
  void runClassification();
  const classifyTimer = setInterval(() => void runClassification(), classifyIntervalMs);
  classifyTimer.unref();

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearInterval(classifyTimer);
    await tokenWorker.close();
    await worker.close();
    await application.close();
  };
  process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));
  process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
}

void startWorker().catch((error) => {
  console.error('[worker:sync] failed to start', error);
  process.exitCode = 1;
});
