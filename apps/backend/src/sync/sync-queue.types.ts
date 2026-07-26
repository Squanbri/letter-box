import type { SyncResult } from '@letter-box/contracts';

export const SYNC_QUEUE_NAME = 'mailbox-sync';

export interface SyncJobData {
  accountId: string;
  mailbox: string;
}

export type SyncJobResult = SyncResult;
