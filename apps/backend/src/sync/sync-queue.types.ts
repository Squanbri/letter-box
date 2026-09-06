import type { BackfillResult, SyncResult } from '@letter-box/contracts';

export const SYNC_QUEUE_NAME = 'mailbox-sync';
export const SYNC_JOB = 'sync';
export const BACKFILL_JOB = 'backfill';
export const TOKEN_REFRESH_QUEUE_NAME = 'token-refresh';
export const TOKEN_REFRESH_JOB = 'refresh-due';

/** Newest→oldest history walk; 300 sits in the 200–500 FETCH budget. */
export const BACKFILL_BATCH_SIZE = 300;
/** Pause between batches (lock released) so incremental sync can run. */
export const BACKFILL_BATCH_DELAY_MS = 1_500;
/** Stored in Folder.backfilledUid when history walk finished (UIDs are always ≥ 1). */
export const BACKFILL_COMPLETE_UID = 0;

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

export type MailboxJobData = SyncJobData | BackfillJobData;
export type SyncJobResult = SyncResult;
export type MailboxJobResult = SyncResult | BackfillResult;
