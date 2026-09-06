import type { SyncResult } from '@letter-box/contracts';

export const SYNC_QUEUE_NAME = 'mailbox-sync';
export const TOKEN_REFRESH_QUEUE_NAME = 'token-refresh';
export const TOKEN_REFRESH_JOB = 'refresh-due';

export interface SyncJobData {
  accountId: string;
  mailbox: string;
}

export type SyncJobResult = SyncResult;
