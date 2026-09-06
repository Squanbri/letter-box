import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import { EventsGateway } from '../events/events.gateway';
import { OllamaService } from './ollama.service';
import {
  applyImportantHeuristic,
  type MessageTag,
} from './classification.tags';

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);
  private running = false;

  constructor(
    @Inject(PrismaDatabaseService) private readonly database: PrismaDatabaseService,
    @Inject(OllamaService) private readonly ollama: OllamaService,
    @Optional() @Inject(EventsGateway) private readonly events?: EventsGateway,
  ) {}

  async processBatch(): Promise<number> {
    if (!this.ollama.enabled || this.running) return 0;
    this.running = true;
    try {
      const batchSize = Math.min(
        Math.max(Number(process.env.CLASSIFY_BATCH_SIZE ?? 5), 1),
        20,
      );
      const candidates = await this.database.client.message.findMany({
        where: {
          classificationStatus: 'pending',
        },
        orderBy: [{ receivedAt: 'desc' }, { uid: 'desc' }],
        take: batchSize,
        select: {
          accountId: true,
          mailbox: true,
          uid: true,
          subject: true,
          senderAddress: true,
          senderName: true,
          classificationText: true,
          flags: true,
        },
      });
      let classified = 0;
      for (const candidate of candidates) {
        const prepared = candidate.classificationText?.trim() ?? '';
        const fallback = [
          candidate.subject,
          candidate.senderName,
          candidate.senderAddress,
        ].filter(Boolean).join('\n').trim();
        const text = prepared || fallback;
        if (!text) {
          await this.complete(candidate, ['other']);
          classified += 1;
          continue;
        }
        const claimed = await this.claim(candidate);
        if (!claimed) continue;
        try {
          const rawTags = await this.ollama.classify({
            subject: candidate.subject,
            from: candidate.senderAddress || candidate.senderName,
            text,
          });
          const tags = applyImportantHeuristic({
            subject: candidate.subject,
            from: candidate.senderAddress || candidate.senderName,
            text,
            tags: rawTags,
          });
          await this.complete(candidate, tags);
          classified += 1;
          this.events?.publish({
            type: 'classification.completed',
            accountId: candidate.accountId,
            mailbox: candidate.mailbox,
            uid: Number(candidate.uid),
            tags,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Classification failed for ${candidate.accountId}/${candidate.mailbox}/${candidate.uid}: ${message}`);
          if (/fetch failed|ECONNREFUSED|ENOTFOUND|Ollama/i.test(message)) {
            await this.release(candidate);
          } else {
            await this.markFailed(candidate);
          }
        }
      }
      return classified;
    } finally {
      this.running = false;
    }
  }

  /** Fast pass: bump important on already-classified mail via heuristics (no Ollama). */
  async applyImportantHeuristics(limit = 500): Promise<number> {
    const rows = await this.database.client.message.findMany({
      where: {
        classificationStatus: 'completed',
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
        classificationText: true,
        tags: true,
      },
    });
    let updated = 0;
    for (const row of rows) {
      const text = row.classificationText?.trim()
        || [row.subject, row.senderName, row.senderAddress].filter(Boolean).join('\n');
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
        classificationStatus: 'pending',
      },
      data: { classificationStatus: 'processing' },
    }).then((result) => result.count > 0);
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
        classificationStatus: 'completed',
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
