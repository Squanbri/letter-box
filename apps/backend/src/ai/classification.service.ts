import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import { EventsGateway } from '../events/events.gateway';
import { prepareClassificationText } from '../mail/imap.service';
import { OllamaService } from './ollama.service';
import {
  applyImportantHeuristic,
  collapseQuotedHistory,
  type MessageTag,
} from './classification.tags';
import { TaggingQueueService } from './tagging-queue.service';
import {
  TAG_BODY_SOFT_LIMIT,
  type TagMessageJobData,
  type TagMessageJobResult,
  tagMaxAttempts,
} from './tagging-queue.types';

const TAGGED_STATUSES = ['tagged', 'completed'] as const;

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    @Inject(PrismaDatabaseService) private readonly database: PrismaDatabaseService,
    @Inject(OllamaService) private readonly ollama: OllamaService,
    @Optional() @Inject(EventsGateway) private readonly events?: EventsGateway,
    @Optional() @Inject(TaggingQueueService) private readonly tagging?: TaggingQueueService,
  ) {}

  /**
   * Process a single message tagging job (event-driven worker entrypoint).
   * Increments tagAttempts; after the limit marks failed without rethrowing.
   */
  async tagMessage(job: TagMessageJobData): Promise<TagMessageJobResult> {
    if (!this.ollama.enabled) return { status: 'skipped' };

    const row = await this.database.client.message.findUnique({
      where: {
        accountId_mailbox_uid: {
          accountId: job.accountId,
          mailbox: job.mailbox,
          uid: BigInt(job.uid),
        },
      },
      select: {
        accountId: true,
        mailbox: true,
        uid: true,
        subject: true,
        senderAddress: true,
        senderName: true,
        bodyText: true,
        classificationText: true,
        classificationStatus: true,
        tagAttempts: true,
        flags: true,
      },
    });
    if (!row) return { status: 'skipped' };
    if (TAGGED_STATUSES.includes(row.classificationStatus as typeof TAGGED_STATUSES[number])) {
      return { status: 'skipped' };
    }
    if (
      row.classificationStatus === 'failed'
      && row.tagAttempts >= tagMaxAttempts()
    ) {
      return { status: 'skipped' };
    }

    const claimed = await this.claim(row);
    if (!claimed) return { status: 'skipped' };

    const text = this.resolveTagText(row);
    if (!text) {
      await this.complete(row, ['other']);
      return { status: 'tagged' };
    }

    try {
      const rawTags = await this.ollama.classify({
        subject: row.subject,
        from: row.senderAddress || row.senderName,
        text,
      });
      const tags = applyImportantHeuristic({
        subject: row.subject,
        from: row.senderAddress || row.senderName,
        text,
        tags: rawTags,
      });
      await this.complete(row, tags);
      this.events?.publish({
        type: 'classification.completed',
        accountId: row.accountId,
        mailbox: row.mailbox,
        uid: Number(row.uid),
        tags,
      });
      return { status: 'tagged' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Tagging failed for ${row.accountId}/${row.mailbox}/${row.uid}: ${message}`,
      );
      const attempts = await this.currentAttempts(row);
      if (attempts >= tagMaxAttempts()) {
        await this.markFailed(row);
        return { status: 'failed' };
      }
      await this.release(row);
      // Rethrow so BullMQ retries with backoff while attempts remain.
      throw error;
    }
  }

  /** Safety-net: enqueue pending messages that never got a tag job. */
  async enqueuePendingSweep(limit = 100): Promise<number> {
    if (!this.tagging || !this.ollama.enabled) return 0;
    // Recover jobs stuck in processing after a worker crash.
    await this.database.client.message.updateMany({
      where: {
        classificationStatus: 'processing',
        tagAttempts: { lt: tagMaxAttempts() },
      },
      data: { classificationStatus: 'pending' },
    });
    const candidates = await this.database.client.message.findMany({
      where: {
        classificationStatus: 'pending',
        tagAttempts: { lt: tagMaxAttempts() },
      },
      orderBy: [{ receivedAt: 'desc' }, { uid: 'desc' }],
      take: limit,
      select: { accountId: true, mailbox: true, uid: true },
    });
    let enqueued = 0;
    for (const candidate of candidates) {
      const result = await this.tagging.enqueueTag(
        candidate.accountId,
        candidate.mailbox,
        Number(candidate.uid),
        'sweep',
      );
      if (result.queued) enqueued += 1;
    }
    return enqueued;
  }

  /** Fast pass: bump important on already-tagged mail via heuristics (no Ollama). */
  async applyImportantHeuristics(limit = 500): Promise<number> {
    const rows = await this.database.client.message.findMany({
      where: {
        classificationStatus: { in: [...TAGGED_STATUSES] },
        NOT: { tags: { array_contains: ['important'] } },
      },
      orderBy: [{ receivedAt: 'desc' }, { uid: 'desc' }],
      take: limit,
      select: {
        accountId: true,
        mailbox: true,
        uid: true,
        subject: true,
        senderAddress: true,
        senderName: true,
        bodyText: true,
        classificationText: true,
        tags: true,
      },
    });
    let updated = 0;
    for (const row of rows) {
      const text = this.resolveTagText(row);
      const current = Array.isArray(row.tags)
        ? row.tags.filter((tag): tag is MessageTag => typeof tag === 'string')
        : (['other'] as MessageTag[]);
      const tags = applyImportantHeuristic({
        subject: row.subject,
        from: row.senderAddress || row.senderName,
        text,
        tags: current.length ? current : ['other'],
      });
      if (!tags.includes('important')) continue;
      if (tags.join(',') === current.join(',')) continue;
      await this.database.client.message.updateMany({
        where: {
          accountId: row.accountId,
          mailbox: row.mailbox,
          uid: row.uid,
        },
        data: { tags, classifiedAt: new Date() },
      });
      updated += 1;
      this.events?.publish({
        type: 'classification.completed',
        accountId: row.accountId,
        mailbox: row.mailbox,
        uid: Number(row.uid),
        tags,
      });
    }
    return updated;
  }

  private resolveTagText(row: {
    subject: string | null;
    senderName: string | null;
    senderAddress: string | null;
    bodyText?: string | null;
    classificationText?: string | null;
  }): string {
    const raw = row.bodyText?.trim()
      || row.classificationText?.trim()
      || [row.subject, row.senderName, row.senderAddress].filter(Boolean).join('\n').trim();
    if (!raw) return '';
    const collapsed = collapseQuotedHistory(raw);
    return prepareClassificationText(collapsed, TAG_BODY_SOFT_LIMIT);
  }

  private claim(candidate: {
    accountId: string;
    mailbox: string;
    uid: bigint;
  }): Promise<boolean> {
    return this.database.client.message.updateMany({
      where: {
        accountId: candidate.accountId,
        mailbox: candidate.mailbox,
        uid: candidate.uid,
        classificationStatus: { in: ['pending', 'failed'] },
        tagAttempts: { lt: tagMaxAttempts() },
      },
      data: {
        classificationStatus: 'processing',
        tagAttempts: { increment: 1 },
      },
    }).then((result) => result.count > 0);
  }

  private async currentAttempts(candidate: {
    accountId: string;
    mailbox: string;
    uid: bigint;
  }): Promise<number> {
    const row = await this.database.client.message.findUnique({
      where: {
        accountId_mailbox_uid: {
          accountId: candidate.accountId,
          mailbox: candidate.mailbox,
          uid: candidate.uid,
        },
      },
      select: { tagAttempts: true },
    });
    return row?.tagAttempts ?? tagMaxAttempts();
  }

  private complete(
    candidate: { accountId: string; mailbox: string; uid: bigint },
    tags: MessageTag[],
  ): Promise<unknown> {
    return this.database.client.message.updateMany({
      where: {
        accountId: candidate.accountId,
        mailbox: candidate.mailbox,
        uid: candidate.uid,
      },
      data: {
        tags,
        classificationStatus: 'tagged',
        classifiedAt: new Date(),
      },
    });
  }

  private release(candidate: {
    accountId: string;
    mailbox: string;
    uid: bigint;
  }): Promise<unknown> {
    return this.database.client.message.updateMany({
      where: {
        accountId: candidate.accountId,
        mailbox: candidate.mailbox,
        uid: candidate.uid,
        classificationStatus: 'processing',
      },
      data: { classificationStatus: 'pending' },
    });
  }

  private markFailed(candidate: {
    accountId: string;
    mailbox: string;
    uid: bigint;
  }): Promise<unknown> {
    return this.database.client.message.updateMany({
      where: {
        accountId: candidate.accountId,
        mailbox: candidate.mailbox,
        uid: candidate.uid,
      },
      data: {
        tags: ['other'],
        classificationStatus: 'failed',
        classifiedAt: new Date(),
      },
    });
  }
}
