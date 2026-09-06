export const TAGGING_QUEUE_NAME = 'message-tagging';
export const TAG_MESSAGE_JOB = 'tag-message';
export const TAG_SWEEP_JOB = 'tag-sweep';

/** BullMQ: lower number = higher priority. */
export const TAG_PRIORITY_SYNC = 1;
export const TAG_PRIORITY_SWEEP = 5;
export const TAG_PRIORITY_BACKFILL = 10;

export const TAG_MAX_ATTEMPTS = 3;
  /** Soft cap after quote collapse — not the old 1.2–1.5k aggressive trim. */
export const TAG_BODY_SOFT_LIMIT = 12_000;
/** Safety-net sweep interval (default 60 seconds while catching up). */
export const TAG_SWEEP_INTERVAL_MS = 60_000;

export type TagMessageSource = 'sync' | 'backfill' | 'sweep';

export interface TagMessageJobData {
  accountId: string;
  mailbox: string;
  uid: number;
  source: TagMessageSource;
}

export type TagSweepJobData = Record<string, never>;

export type TaggingJobData = TagMessageJobData | TagSweepJobData;

export type TagMessageJobResult = {
  status: 'tagged' | 'failed' | 'skipped';
};

export type TagSweepJobResult = {
  enqueued: number;
};

export type TaggingJobResult = TagMessageJobResult | TagSweepJobResult;

export function tagPriorityFor(source: TagMessageSource): number {
  if (source === 'sync') return TAG_PRIORITY_SYNC;
  if (source === 'backfill') return TAG_PRIORITY_BACKFILL;
  return TAG_PRIORITY_SWEEP;
}

export function tagSweepIntervalMs(): number {
  const raw = Number(process.env.TAG_SWEEP_INTERVAL_MS ?? TAG_SWEEP_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : TAG_SWEEP_INTERVAL_MS;
}

export function tagMaxAttempts(): number {
  const raw = Number(process.env.TAG_MAX_ATTEMPTS ?? TAG_MAX_ATTEMPTS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : TAG_MAX_ATTEMPTS;
}
