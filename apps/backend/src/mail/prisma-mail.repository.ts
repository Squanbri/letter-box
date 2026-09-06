import { Inject, Injectable } from '@nestjs/common';
import type { MailboxRecord } from '@letter-box/contracts';
import { Prisma } from '../generated/prisma/client';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import {
  parseMessageIds,
  serializeReferences,
  type MessageRow,
} from './mail.types';
import type {
  ClassificationPreparation,
  ClassificationStatus,
  MailboxChanges,
  MessageMetadata,
} from './mail.types';

@Injectable()
export class PrismaMailRepository {
  constructor(
    @Inject(PrismaDatabaseService) private readonly database: PrismaDatabaseService,
  ) {}

  async mailboxState(accountId: string, mailbox: string): Promise<string | undefined> {
    const state = await this.database.client.mailboxState.findUnique({
      where: { accountId_mailbox: { accountId, mailbox } },
      select: { uidValidity: true },
    });
    return state?.uidValidity;
  }

  async knownUids(accountId: string, mailbox: string): Promise<number[]> {
    const messages = await this.database.client.message.findMany({
      where: { accountId, mailbox },
      select: { uid: true },
      orderBy: { uid: 'asc' },
    });
    return messages.map(({ uid }) => Number(uid));
  }

  async applyChanges(
    accountId: string,
    mailbox: string,
    changes: MailboxChanges,
  ): Promise<number> {
    return this.database.client.$transaction(async (transaction) => {
      let removed = 0;
      if (changes.reset) {
        removed += (await transaction.message.deleteMany({
          where: { accountId, mailbox },
        })).count;
      }
      await transaction.mailboxState.upsert({
        where: { accountId_mailbox: { accountId, mailbox } },
        create: { accountId, mailbox, uidValidity: changes.uidValidity },
        update: { uidValidity: changes.uidValidity },
      });

      for (const message of changes.messages) {
        await this.upsertMessage(transaction, accountId, mailbox, message);
      }
      for (const update of changes.flagUpdates) {
        await transaction.message.updateMany({
          where: { accountId, mailbox, uid: BigInt(update.uid) },
          data: { flags: update.flags },
        });
      }
      await this.saveClassificationPreparationsWithClient(
        transaction,
        accountId,
        mailbox,
        changes.classificationPreparations ?? [],
      );

      const stale = await transaction.message.deleteMany({
        where: {
          accountId,
          mailbox,
          ...(changes.serverUids.length > 0
            ? { uid: { notIn: changes.serverUids.map(BigInt) } }
            : {}),
        },
      });
      removed += stale.count;
      return removed;
    });
  }

  async listMessages(
    accountId: string,
    mailbox: string,
    limit: number,
    offset: number,
    tag?: string,
  ): Promise<MessageRow[]> {
    const rows = await this.database.client.message.findMany({
      where: {
        accountId,
        mailbox,
        ...(tag
          ? { tags: { array_contains: [tag] } }
          : {}),
      },
      orderBy: [{ receivedAt: 'desc' }, { uid: 'desc' }],
      take: limit,
      skip: offset,
    });
    return rows.map((row) => this.normalizeMessage(row));
  }

  async listInbox(
    accountIds: string[],
    options: {
      mailbox: string;
      limit: number;
      offset: number;
      unreadOnly?: boolean;
      tag?: string;
    },
  ): Promise<MessageRow[]> {
    if (accountIds.length === 0) return [];
    // Merge per-account newest pages, then sort globally.
    // A single SQL LIMIT across account_id IN (...) can return one mailbox's
    // slice first depending on the plan/index; this keeps chronology correct.
    const window = options.offset + options.limit;
    const batches = await Promise.all(accountIds.map((accountId) => (
      this.database.client.message.findMany({
        where: {
          accountId,
          mailbox: options.mailbox,
          ...(options.tag
            ? { tags: { array_contains: [options.tag] } }
            : {}),
          ...(options.unreadOnly
            ? {
              NOT: {
                flags: {
                  array_contains: '\\Seen',
                },
              },
            }
            : {}),
        },
        orderBy: [{ receivedAt: 'desc' }, { uid: 'desc' }],
        take: window,
      })
    )));
    return batches
      .flat()
      .sort((left, right) => {
        const byDate = right.receivedAt.getTime() - left.receivedAt.getTime();
        return byDate !== 0 ? byDate : Number(right.uid) - Number(left.uid);
      })
      .slice(options.offset, options.offset + options.limit)
      .map((row) => this.normalizeMessage(row));
  }

  async tagCounts(
    accountId: string,
    mailbox: string,
  ): Promise<Array<{ tag: string; count: number }>> {
    return this.messagesByTag([accountId], mailbox, true);
  }

  async messagesByDay(
    accountIds: string[],
    mailbox: string,
    since: Date,
  ): Promise<Array<{ accountId: string; date: string; count: number }>> {
    if (accountIds.length === 0) return [];
    const rows = await this.database.client.$queryRaw<Array<{
      account_id: string;
      date: Date;
      count: bigint;
    }>>(
      Prisma.sql`
        SELECT account_id, date_trunc('day', received_at)::date AS date, COUNT(*)::bigint AS count
        FROM messages
        WHERE account_id IN (${Prisma.join(accountIds)})
          AND mailbox = ${mailbox}
          AND received_at >= ${since}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `,
    );
    return rows.map((row) => ({
      accountId: row.account_id,
      date: row.date instanceof Date
        ? row.date.toISOString().slice(0, 10)
        : String(row.date).slice(0, 10),
      count: Number(row.count),
    }));
  }

  async messagesByTag(
    accountIds: string[],
    mailbox: string,
    unreadOnly = false,
  ): Promise<Array<{ tag: string; count: number }>> {
    if (accountIds.length === 0) return [];
    const rows = await this.database.client.$queryRaw<Array<{ tag: string; count: bigint }>>(
      Prisma.sql`
        SELECT tag, COUNT(*)::bigint AS count
        FROM messages
        CROSS JOIN LATERAL jsonb_array_elements_text(tags::jsonb) AS tag
        WHERE account_id IN (${Prisma.join(accountIds)})
          AND mailbox = ${mailbox}
          ${unreadOnly
            ? Prisma.sql`AND NOT (flags::jsonb @> '["\\\\Seen"]'::jsonb)`
            : Prisma.empty}
        GROUP BY tag
        ORDER BY count DESC, tag ASC
      `,
    );
    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
  }

  async messagesByTagByAccount(
    accountIds: string[],
    mailbox: string,
  ): Promise<Array<{
    tag: string;
    accountId: string;
    count: number;
    unreadCount: number;
  }>> {
    if (accountIds.length === 0) return [];
    const rows = await this.database.client.$queryRaw<Array<{
      tag: string;
      account_id: string;
      count: bigint;
      unread_count: bigint;
    }>>(
      Prisma.sql`
        SELECT
          tag,
          account_id,
          COUNT(*)::bigint AS count,
          COUNT(*) FILTER (
            WHERE NOT (flags::jsonb @> '["\\\\Seen"]'::jsonb)
          )::bigint AS unread_count
        FROM messages
        CROSS JOIN LATERAL jsonb_array_elements_text(tags::jsonb) AS tag
        WHERE account_id IN (${Prisma.join(accountIds)})
          AND mailbox = ${mailbox}
        GROUP BY tag, account_id
        ORDER BY tag ASC, account_id ASC
      `,
    );
    return rows.map((row) => ({
      tag: row.tag,
      accountId: row.account_id,
      count: Number(row.count),
      unreadCount: Number(row.unread_count),
    }));
  }

  async awaitingReply(
    accountIds: string[],
    mailbox: string,
    limit = 8,
  ): Promise<Array<{
    accountId: string;
    mailbox: string;
    uid: number;
    subject: string | null;
    fromName: string | null;
    fromAddress: string | null;
    date: string;
  }>> {
    if (accountIds.length === 0) return [];
    const rows = await this.database.client.$queryRaw<Array<{
      account_id: string;
      mailbox: string;
      uid: bigint;
      subject: string | null;
      sender_name: string | null;
      sender_address: string | null;
      received_at: Date;
    }>>(
      Prisma.sql`
        SELECT account_id, mailbox, uid, subject, sender_name, sender_address, received_at
        FROM messages
        WHERE account_id IN (${Prisma.join(accountIds)})
          AND mailbox = ${mailbox}
          AND flags::jsonb @> '["\\\\Seen"]'::jsonb
          AND NOT (flags::jsonb @> '["\\\\Answered"]'::jsonb)
          AND NOT (flags::jsonb @> '["\\\\Draft"]'::jsonb)
        ORDER BY received_at ASC
        LIMIT ${limit}
      `,
    );
    return rows.map((row) => ({
      accountId: row.account_id,
      mailbox: row.mailbox,
      uid: Number(row.uid),
      subject: row.subject,
      fromName: row.sender_name,
      fromAddress: row.sender_address,
      date: row.received_at.toISOString(),
    }));
  }

  async messageTotals(
    accountIds: string[],
    mailbox: string,
  ): Promise<{ total: number; classified: number }> {
    if (accountIds.length === 0) return { total: 0, classified: 0 };
    const rows = await this.database.client.$queryRaw<Array<{
      total: bigint;
      classified: bigint;
    }>>(
      Prisma.sql`
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (
            WHERE tag_status IN ('tagged', 'completed', 'done')
              OR jsonb_array_length(COALESCE(tags::jsonb, '[]'::jsonb)) > 0
          )::bigint AS classified
        FROM messages
        WHERE account_id IN (${Prisma.join(accountIds)})
          AND mailbox = ${mailbox}
      `,
    );
    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      classified: Number(row?.classified ?? 0),
    };
  }

  async listMailboxes(accountId: string): Promise<MailboxRecord[]> {
    const rows = await this.database.client.mailbox.findMany({
      where: { accountId },
    });
    return rows
      .map((row) => ({
        path: row.path,
        name: row.name,
        delimiter: row.delimiter,
        specialUse: row.specialUse,
        totalCount: row.totalCount,
        unreadCount: row.unreadCount,
      }))
      .sort((left, right) => {
        const special = (value: string | null) => [
          '\\Inbox', '\\Sent', '\\Drafts', '\\Junk', '\\Trash',
        ].indexOf(value ?? '');
        const leftOrder = special(left.specialUse);
        const rightOrder = special(right.specialUse);
        return (leftOrder < 0 ? 5 : leftOrder) - (rightOrder < 0 ? 5 : rightOrder)
          || left.name.localeCompare(right.name);
      });
  }

  async replaceMailboxes(accountId: string, mailboxes: MailboxRecord[]): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      const listedAt = new Date();
      for (const mailbox of mailboxes) {
        await transaction.mailbox.upsert({
          where: { accountId_path: { accountId, path: mailbox.path } },
          create: {
            accountId,
            path: mailbox.path,
            name: mailbox.name,
            delimiter: mailbox.delimiter,
            specialUse: mailbox.specialUse,
            totalCount: mailbox.totalCount,
            unreadCount: mailbox.unreadCount,
            listedAt,
          },
          update: {
            name: mailbox.name,
            delimiter: mailbox.delimiter,
            specialUse: mailbox.specialUse,
            totalCount: mailbox.totalCount,
            unreadCount: mailbox.unreadCount,
            listedAt,
          },
        });
      }
      await transaction.mailbox.deleteMany({
        where: {
          accountId,
          ...(mailboxes.length > 0
            ? { path: { notIn: mailboxes.map(({ path }) => path) } }
            : {}),
        },
      });
    });
  }

  async saveMessages(
    accountId: string,
    mailbox: string,
    messages: MessageMetadata[],
  ): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      for (const message of messages) {
        await this.upsertMessage(transaction, accountId, mailbox, message);
      }
    });
  }

  async findMessage(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<MessageRow | undefined> {
    const row = await this.database.client.message.findUnique({
      where: {
        accountId_mailbox_uid: {
          accountId,
          mailbox,
          uid: BigInt(uid),
        },
      },
    });
    return row ? this.normalizeMessage(row) : undefined;
  }

  async listThread(accountId: string, threadId: string): Promise<MessageRow[]> {
    const rows = await this.database.client.message.findMany({
      where: { accountId, threadId },
      orderBy: [{ receivedAt: 'asc' }, { uid: 'asc' }],
    });
    return rows.map((row) => this.normalizeMessage(row));
  }

  async classificationCandidateUids(
    accountId: string,
    mailbox: string,
  ): Promise<number[]> {
    const rows = await this.database.client.message.findMany({
      where: { accountId, mailbox, classificationText: null },
      select: { uid: true, flags: true },
      orderBy: { uid: 'asc' },
    });
    return rows
      .filter(({ flags }) =>
        !Array.isArray(flags) || !flags.includes('\\Seen'))
      .map(({ uid }) => Number(uid));
  }

  async saveClassificationPreparations(
    accountId: string,
    mailbox: string,
    preparations: ClassificationPreparation[],
  ): Promise<void> {
    await this.database.client.$transaction((transaction) =>
      this.saveClassificationPreparationsWithClient(
        transaction,
        accountId,
        mailbox,
        preparations,
      ));
  }

  async saveBody(
    accountId: string,
    mailbox: string,
    uid: number,
    body: {
      text: string | null;
      html: string | null;
      messageId?: string | null;
      inReplyTo?: string | null;
      references?: string[];
      threadId?: string | null;
    },
    loadedAt: string,
  ): Promise<void> {
    await this.database.client.message.updateMany({
      where: { accountId, mailbox, uid: BigInt(uid) },
      data: {
        bodyText: body.text,
        bodyHtml: body.html,
        bodyLoadedAt: new Date(loadedAt),
        ...(body.messageId !== undefined ? { messageId: body.messageId } : {}),
        ...(body.inReplyTo !== undefined ? { inReplyTo: body.inReplyTo } : {}),
        ...(body.references !== undefined
          ? { referencesHeader: serializeReferences(body.references) }
          : {}),
        ...(body.threadId !== undefined ? { threadId: body.threadId } : {}),
      },
    });
  }

  async saveFlags(
    accountId: string,
    mailbox: string,
    uid: number,
    flags: string[],
  ): Promise<void> {
    await this.database.client.message.updateMany({
      where: { accountId, mailbox, uid: BigInt(uid) },
      data: { flags },
    });
  }

  async hasMailbox(accountId: string, mailbox: string): Promise<boolean> {
    return Boolean(await this.database.client.mailbox.findUnique({
      where: { accountId_path: { accountId, path: mailbox } },
      select: { path: true },
    }));
  }

  async specialMailbox(accountId: string, specialUse: string): Promise<string | undefined> {
    const mailbox = await this.database.client.mailbox.findFirst({
      where: { accountId, specialUse },
      select: { path: true },
    });
    return mailbox?.path;
  }

  async removeMessage(accountId: string, mailbox: string, uid: number): Promise<void> {
    await this.database.client.message.deleteMany({
      where: { accountId, mailbox, uid: BigInt(uid) },
    });
  }

  private upsertMessage(
    transaction: Prisma.TransactionClient,
    accountId: string,
    mailbox: string,
    message: MessageMetadata,
  ) {
    const data = {
      subject: message.subject,
      senderName: message.senderName,
      senderAddress: message.senderAddress,
      receivedAt: new Date(message.date),
      flags: message.flags,
      size: BigInt(message.size),
      messageId: message.messageId,
      inReplyTo: message.inReplyTo,
      referencesHeader: serializeReferences(message.references),
      threadId: message.threadId,
    };
    return transaction.message.upsert({
      where: {
        accountId_mailbox_uid: {
          accountId,
          mailbox,
          uid: BigInt(message.uid),
        },
      },
      create: {
        accountId,
        mailbox,
        uid: BigInt(message.uid),
        ...data,
      },
      update: data,
    });
  }

  private normalizeMessage(row: {
    accountId: string;
    mailbox: string;
    uid: bigint;
    subject: string | null;
    senderName: string | null;
    senderAddress: string | null;
    receivedAt: Date;
    flags: Prisma.JsonValue;
    size: bigint;
    bodyText: string | null;
    bodyHtml: string | null;
    bodyLoadedAt: Date | null;
    classificationText: string | null;
    classificationStatus: string;
    classifiedAt: Date | null;
    tags: Prisma.JsonValue;
    messageId?: string | null;
    inReplyTo?: string | null;
    referencesHeader?: string | null;
    threadId?: string | null;
  }): MessageRow {
    return {
      account_id: row.accountId,
      mailbox: row.mailbox,
      uid: Number(row.uid),
      subject: row.subject,
      sender_name: row.senderName,
      sender_address: row.senderAddress,
      received_at: row.receivedAt.toISOString(),
      flags: JSON.stringify(row.flags),
      size: Number(row.size),
      body_text: row.bodyText,
      body_html: row.bodyHtml,
      body_loaded_at: row.bodyLoadedAt?.toISOString() ?? null,
      classification_text: row.classificationText,
      classification_status: row.classificationStatus as ClassificationStatus,
      classified_at: row.classifiedAt?.toISOString() ?? null,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      message_id: row.messageId ?? null,
      in_reply_to: row.inReplyTo ?? null,
      references_header: row.referencesHeader ?? null,
      thread_id: row.threadId ?? null,
    };
  }

  private async saveClassificationPreparationsWithClient(
    client: Prisma.TransactionClient,
    accountId: string,
    mailbox: string,
    preparations: ClassificationPreparation[],
  ): Promise<void> {
    for (const preparation of preparations) {
      await client.message.updateMany({
        where: {
          accountId,
          mailbox,
          uid: BigInt(preparation.uid),
          classificationText: null,
        },
        data: {
          classificationText: preparation.text,
          classificationStatus: preparation.status,
        },
      });
    }
  }
}
