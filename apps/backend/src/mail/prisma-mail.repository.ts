import { Injectable } from '@nestjs/common';
import type { MailboxRecord } from '@letter-box/contracts';
import type { Prisma } from '../generated/prisma/client';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import type {
  ClassificationPreparation,
  ClassificationStatus,
  MailboxChanges,
  MessageMetadata,
} from './mail.types';
import type { MessageRow } from './mail.types';

@Injectable()
export class PrismaMailRepository {
  constructor(private readonly database: PrismaDatabaseService) {}

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
  ): Promise<MessageRow[]> {
    const rows = await this.database.client.message.findMany({
      where: { accountId, mailbox },
      orderBy: [{ receivedAt: 'desc' }, { uid: 'desc' }],
      take: limit,
      skip: offset,
    });
    return rows.map((row) => this.normalizeMessage(row));
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
    body: { text: string | null; html: string | null },
    loadedAt: string,
  ): Promise<void> {
    await this.database.client.message.updateMany({
      where: { accountId, mailbox, uid: BigInt(uid) },
      data: {
        bodyText: body.text,
        bodyHtml: body.html,
        bodyLoadedAt: new Date(loadedAt),
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
