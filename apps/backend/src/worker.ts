import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppModule } from './app.module';
import { AccountService } from './account/account.service';
import { FileCredentialStore } from './account/file-credential.store';
import { ClassificationService } from './ai/classification.service';
import { OllamaService } from './ai/ollama.service';
import { MailService } from './mail/mail.service';
import { TokenService } from './account/token.service';
import { configureRuntime } from './runtime';
import { SyncQueueService } from './sync/sync-queue.service';
import { SyncSchedulerService } from './sync/sync-scheduler.service';
import {
  TAG_MESSAGE_JOB,
  TAG_SWEEP_JOB,
  TAGGING_QUEUE_NAME,
  type TagMessageJobData,
  type TaggingJobData,
  type TaggingJobResult,
} from './ai/tagging-queue.types';
import {
  BACKFILL_JOB,
  BackfillJobData,
  MailboxJobData,
  MailboxJobResult,
  SYNC_QUEUE_NAME,
  SYNC_TICK_FOLDERS_JOB,
  SYNC_TICK_INBOX_JOB,
  TOKEN_REFRESH_QUEUE_NAME,
  SyncJobData,
} from './sync/sync-queue.types';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(__dirname, '../../../.env') });

async function startWorker(): Promise<void> {
  process.env.LETTER_BOX_PROCESS_ROLE = 'worker';
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL обязателен для sync worker');

  configureRuntime({ credentialStore: new FileCredentialStore() });
  const application = await NestFactory.createApplicationContext(AppModule);
  const accounts = application.get(AccountService);
  const mail = application.get(MailService);
  const classification = application.get(ClassificationService);
  const ollama = application.get(OllamaService);
  const tokens = application.get(TokenService);
  const syncQueue = application.get(SyncQueueService);
  const scheduler = application.get(SyncSchedulerService);
  const worker = new Worker<MailboxJobData, MailboxJobResult>(
    SYNC_QUEUE_NAME,
    async (job) => {
      if (job.name === SYNC_TICK_INBOX_JOB) {
        return scheduler.tickInbox();
      }
      if (job.name === SYNC_TICK_FOLDERS_JOB) {
        return scheduler.tickFolders();
      }

      await accounts.reloadCredential(job.data.accountId);
      if (job.name === BACKFILL_JOB) {
        const data = job.data as BackfillJobData;
        return mail.backfillMailbox(data.accountId, data.mailbox, {
          force: data.force,
        });
      }
      const data = job.data as SyncJobData;
      const result = await mail.syncMailbox(data.accountId, data.mailbox);
      void syncQueue.enqueueBackfill(data.accountId, data.mailbox, {
        force: Boolean(result.uidValidityReset),
      }).catch((error) => {
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
      lockDuration: 120_000,
    },
  );

  worker.on('failed', (job, error) => {
    console.error(`[worker:${job?.name ?? 'sync'}] job failed`, {
      jobId: job?.id,
      accountId: job?.data && 'accountId' in job.data ? job.data.accountId : undefined,
      mailbox: job?.data && 'mailbox' in job.data ? job.data.mailbox : undefined,
      attempt: job?.attemptsMade,
      error: error.message,
    });
  });
  worker.on('error', (error) => {
    console.error('[worker:sync] queue error', error);
  });
  await worker.waitUntilReady();
  console.info('[worker:sync] ready', {
    inboxIntervalMs: process.env.SYNC_INBOX_INTERVAL_MS ?? 60_000,
    folderIntervalMs: process.env.SYNC_FOLDER_INTERVAL_MS ?? 300_000,
  });

  const taggingWorker = new Worker<TaggingJobData, TaggingJobResult>(
    TAGGING_QUEUE_NAME,
    async (job) => {
      if (job.name === TAG_SWEEP_JOB) {
        const boosted = await classification.applyImportantHeuristics();
        if (boosted > 0) {
          console.info(`[worker:tag] boosted important on ${boosted} message(s)`);
        }
        const enqueued = await classification.enqueuePendingSweep();
        if (enqueued > 0) {
          console.info(`[worker:tag] sweep enqueued ${enqueued} pending message(s)`);
        }
        return { enqueued };
      }
      const data = job.data as TagMessageJobData;
      return classification.tagMessage(data);
    },
    {
      connection: { url: redisUrl },
      // Ollama does not parallelize well on a single local model.
      concurrency: 1,
      lockDuration: 300_000,
    },
  );
  taggingWorker.on('failed', (job, error) => {
    console.error('[worker:tag] job failed', {
      jobId: job?.id,
      name: job?.name,
      attempt: job?.attemptsMade,
      error: error.message,
    });
  });
  taggingWorker.on('error', (error) => {
    console.error('[worker:tag] queue error', error);
  });
  await taggingWorker.waitUntilReady();
  console.info('[worker:tag] ready', {
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
    concurrency: 1,
  });

  const ollamaOk = await ollama.healthy();
  console.info('[worker:tag] ollama', {
    url: ollama.baseUrl,
    model: ollama.model,
    healthy: ollamaOk,
  });
  if (ollamaOk) {
    const recovered = await classification.requeueFailed(2_000);
    const enqueued = await classification.enqueuePendingSweep(300);
    console.info('[worker:tag] boot catch-up', { recovered, enqueued });
  } else {
    console.warn(
      '[worker:tag] Ollama не отвечает — теги появятся только после запуска ollama serve',
    );
  }

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

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await taggingWorker.close();
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
