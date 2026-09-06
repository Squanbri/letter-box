import type { BackfillResult, SyncResult } from '@letter-box/contracts';

export const SYNC_QUEUE_NAME = 'mailbox-sync';
export const SYNC_JOB = 'sync';
export const BACKFILL_JOB = 'backfill';
export const SYNC_TICK_INBOX_JOB = 'sync-tick-inbox';
export const SYNC_TICK_FOLDERS_JOB = 'sync-tick-folders';
export const TOKEN_REFRESH_QUEUE_NAME = 'token-refresh';
export const TOKEN_REFRESH_JOB = 'refresh-due';

/** Newest→oldest history walk; 300 sits in the 200–500 FETCH budget. */
export const BACKFILL_BATCH_SIZE = 300;
/** Pause between batches (lock released) so incremental sync can run. */
export const BACKFILL_BATCH_DELAY_MS = 1_500;
/** Stored in Folder.backfilledUid when history walk finished (UIDs are always ≥ 1). */
export const BACKFILL_COMPLETE_UID = 0;

/** Default INBOX poll interval (1 minute). Override with SYNC_INBOX_INTERVAL_MS. */
export const SYNC_INBOX_INTERVAL_MS = 60_000;
/** Default non-INBOX poll interval (5 minutes). Override with SYNC_FOLDER_INTERVAL_MS. */
export const SYNC_FOLDER_INTERVAL_MS = 300_000;
/** First backoff step after a connection/auth failure. Override with SYNC_BACKOFF_BASE_MS. */
export const SYNC_BACKOFF_BASE_MS = 60_000;
/** Backoff ceiling. Override with SYNC_BACKOFF_MAX_MS. */
export const SYNC_BACKOFF_MAX_MS = 30 * 60_000;

export interface SyncJobData {
  accountId: string;
  mailbox: string;
}

export interface BackfillJobData {
  accountId: string;
  mailbox: string;
  /** When true, clears a completed cursor and walks history again. */
  force?: boolean;
}

export type SchedulerTickJobData = Record<string, never>;

export type MailboxJobData = SyncJobData | BackfillJobData | SchedulerTickJobData;
export type SyncJobResult = SyncResult;
export type SchedulerTickResult = { enqueued: number; skipped: number };
export type MailboxJobResult = SyncResult | BackfillResult | SchedulerTickResult;

export function syncInboxIntervalMs(): number {
  return positiveEnv('SYNC_INBOX_INTERVAL_MS', SYNC_INBOX_INTERVAL_MS);
}

export function syncFolderIntervalMs(): number {
  return positiveEnv('SYNC_FOLDER_INTERVAL_MS', SYNC_FOLDER_INTERVAL_MS);
}

export function syncBackoffBaseMs(): number {
  return positiveEnv('SYNC_BACKOFF_BASE_MS', SYNC_BACKOFF_BASE_MS);
}

export function syncBackoffMaxMs(): number {
  return positiveEnv('SYNC_BACKOFF_MAX_MS', SYNC_BACKOFF_MAX_MS);
}

function positiveEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? fallback);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
