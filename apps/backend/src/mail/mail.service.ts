import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { ImapService } from './imap.service';
import { MailboxRecord, MessageRecord, MessageRow, parseMessageIds } from './mail.types';
import type {
  DashboardStats,
  SendMessageInput,
  SendMessageResult,
  SyncResult,
} from '@letter-box/contracts';
import { BadRequestException } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import {
  MAIL_REPOSITORY,
  MailRepositoryContract,
} from '../database/repository.contracts';
import { SmtpService } from './smtp.service';
export type { SyncResult } from '@letter-box/contracts';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STATS_DAYS = 90;

@Injectable()
export class MailService {
  private readonly syncs = new Map<string, {
    mailbox: string;
    promise: Promise<SyncResult>;
  }>();

  constructor(
    @Inject(MAIL_REPOSITORY) private readonly repository: MailRepositoryContract,
    @Inject(ImapService) private readonly imap: ImapService,
    @Inject(SmtpService) private readonly smtp: SmtpService,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Optional() @Inject(EventsGateway) private readonly events?: EventsGateway,
  ) {}

  async connect(accountId: string): Promise<{ connected: true }> {
    try {
      await this.imap.testConnection(accountId);
      await this.accounts.setStatus(accountId, 'connected');
      return { connected: true };
    } catch (error) {
      await this.accounts.setStatus(accountId, 'error', this.message(error));
      throw error;
    }
  }

  syncMailbox(accountId: string, mailbox = 'INBOX'): Promise<SyncResult> {
    const syncKey = `${accountId}\0${mailbox}`;
    const running = this.syncs.get(syncKey);
    if (running) return running.promise;
    const sync = this.performSync(accountId, mailbox)
      .finally(() => this.syncs.delete(syncKey));
    this.syncs.set(syncKey, { mailbox, promise: sync });
    return sync;
  }

  private async performSync(accountId: string, mailbox: string): Promise<SyncResult> {
    await this.accounts.get(accountId);
    await this.accounts.setStatus(accountId, 'syncing');
    this.events?.publish({ type: 'sync.started', accountId, mailbox });
    try {
      const uidValidity = await this.repository.mailboxState(accountId, mailbox);
      const knownUids = await this.repository.knownUids(accountId, mailbox);
      const classificationCandidateUids =
        await this.repository.classificationCandidateUids(accountId, mailbox);
      const result = await this.imap.fetchChanges(
        accountId,
        mailbox,
        knownUids,
        uidValidity,
        classificationCandidateUids,
      );

      const removed = await this.repository.applyChanges(accountId, mailbox, result);
      await this.accounts.markSynced(accountId);
      const syncResult = {
        synced: result.messages.length + result.flagUpdates.length,
        added: result.messages.length,
        updated: result.flagUpdates.length,
        removed,
      };
      this.events?.publish({
        type: 'sync.completed',
        accountId,
        mailbox,
        result: syncResult,
      });
      return syncResult;
    } catch (error) {
      await this.accounts.setStatus(accountId, 'error', this.message(error));
      this.events?.publish({
        type: 'sync.failed',
        accountId,
        mailbox,
        error: this.message(error),
      });
      throw error;
    }
  }

  async listMessages(
    accountId: string,
    mailbox = 'INBOX',
    limit = 50,
    offset = 0,
    tag?: string,
  ): Promise<MessageRecord[]> {
    await this.accounts.get(accountId);
    const rows = await this.repository.listMessages(
      accountId,
      mailbox,
      Math.min(Math.max(limit, 1), 100),
      Math.max(offset, 0),
      tag,
    );
    return rows.map((row) => this.mapRow(row, false));
  }

  async listInbox(
    userId: string,
    options: {
      mailbox?: string;
      limit?: number;
      offset?: number;
      unreadOnly?: boolean;
      tag?: string;
    } = {},
  ): Promise<MessageRecord[]> {
    const accountIds = (await this.accounts.list(userId)).map(({ id }) => id);
    const rows = await this.repository.listInbox(accountIds, {
      mailbox: options.mailbox ?? 'INBOX',
      limit: Math.min(Math.max(options.limit ?? 50, 1), 100),
      offset: Math.max(options.offset ?? 0, 0),
      unreadOnly: options.unreadOnly,
      tag: options.tag?.trim() || undefined,
    });
    return rows.map((row) => this.mapRow(row, false));
  }

  async tagCounts(
    accountId: string,
    mailbox = 'INBOX',
  ): Promise<Array<{ tag: string; count: number }>> {
    await this.accounts.get(accountId);
    return this.repository.tagCounts(accountId, mailbox);
  }

  async dashboardStats(
    userId: string,
    days = 30,
    mailbox = 'INBOX',
  ): Promise<DashboardStats> {
    const accountIds = (await this.accounts.list(userId)).map(({ id }) => id);
    const windowDays = Math.min(Math.max(days, 1), MAX_STATS_DAYS);
    const since = startOfUtcDay(addUtcDays(new Date(), 1 - windowDays));
    const [rawByDay, messagesByTag, unreadByTag] = await Promise.all([
      this.repository.messagesByDay(accountIds, mailbox, since),
      this.repository.messagesByTag(accountIds, mailbox, false),
      this.repository.messagesByTag(accountIds, mailbox, true),
    ]);
    return {
      messagesByDay: fillDays(rawByDay, since, windowDays),
      messagesByTag,
      unreadByTag,
    };
  }

  async listMailboxes(accountId: string): Promise<MailboxRecord[]> {
    await this.accounts.get(accountId);
    const rows = await this.repository.listMailboxes(accountId);
    return rows.length > 0
      ? rows
      : [{
        path: 'INBOX', name: 'Входящие', delimiter: '/', specialUse: '\\Inbox',
        totalCount: 0, unreadCount: 0,
      }];
  }

  async syncMailboxes(accountId: string): Promise<MailboxRecord[]> {
    await this.accounts.get(accountId);
    const mailboxes = await this.imap.fetchMailboxes(accountId);
    await this.repository.replaceMailboxes(accountId, mailboxes);
    return await this.listMailboxes(accountId);
  }

  async loadOlder(
    accountId: string,
    mailbox: string,
    beforeUid?: number,
  ): Promise<{ loaded: number }> {
    await this.accounts.get(accountId);
    const messages = await this.imap.fetchOlderMetadata(
      accountId,
      mailbox,
      beforeUid,
      50,
    );
    await this.repository.saveMessages(accountId, mailbox, messages);
    return { loaded: messages.length };
  }

  async getMessage(accountId: string, mailbox: string, uid: number): Promise<MessageRecord> {
    let row = await this.findRow(accountId, mailbox, uid);
    if (!row) throw new NotFoundException(`Письмо с UID ${uid} отсутствует в локальной базе`);
    if (!row.body_loaded_at || !row.message_id) {
      const body = await this.imap.fetchBody(accountId, mailbox, uid);
      await this.repository.saveBody(
        accountId,
        mailbox,
        uid,
        body,
        new Date().toISOString(),
      );
      row = (await this.findRow(accountId, mailbox, uid))!;
    }
    return this.mapRow(row, true);
  }

  async listThread(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<MessageRecord[]> {
    await this.accounts.get(accountId);
    const row = await this.findRow(accountId, mailbox, uid);
    if (!row) throw new NotFoundException(`Письмо с UID ${uid} отсутствует в локальной базе`);
    if (!row.thread_id) {
      return [this.mapRow(row, false)];
    }
    const thread = await this.repository.listThread(accountId, row.thread_id);
    return thread.map((item) => this.mapRow(item, false));
  }

  async setSeen(
    accountId: string,
    mailbox: string,
    uid: number,
    seen: boolean,
  ): Promise<MessageRecord> {
    const row = await this.findRow(accountId, mailbox, uid);
    if (!row) {
      throw new NotFoundException(`Письмо с UID ${uid} отсутствует в локальной базе`);
    }
    await this.imap.setSeen(accountId, mailbox, uid, seen);
    const flags = new Set(JSON.parse(row.flags) as string[]);
    if (seen) flags.add('\\Seen');
    else flags.delete('\\Seen');
    await this.repository.saveFlags(accountId, mailbox, uid, [...flags]);
    return this.mapRow(
      (await this.findRow(accountId, mailbox, uid))!,
      Boolean(row.body_loaded_at),
    );
  }

  async setFlagged(
    accountId: string,
    mailbox: string,
    uid: number,
    flagged: boolean,
  ): Promise<MessageRecord> {
    const row = await this.requireRow(accountId, mailbox, uid);
    await this.imap.setFlagged(accountId, mailbox, uid, flagged);
    const flags = new Set(JSON.parse(row.flags) as string[]);
    if (flagged) flags.add('\\Flagged');
    else flags.delete('\\Flagged');
    await this.repository.saveFlags(accountId, mailbox, uid, [...flags]);
    return this.mapRow(
      (await this.findRow(accountId, mailbox, uid))!,
      Boolean(row.body_loaded_at),
    );
  }

  async moveMessage(
    accountId: string,
    mailbox: string,
    uid: number,
    destination: string,
  ): Promise<{ moved: true }> {
    await this.requireRow(accountId, mailbox, uid);
    if (!await this.repository.hasMailbox(accountId, destination)) {
      throw new NotFoundException(`Папка ${destination} не найдена`);
    }
    await this.imap.moveMessage(accountId, mailbox, uid, destination);
    await this.removeLocalMessage(accountId, mailbox, uid);
    return { moved: true };
  }

  async archiveMessage(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<{ moved: true }> {
    const archive = await this.specialMailbox(accountId, '\\Archive');
    if (!archive) throw new NotFoundException('Папка «Архив» не найдена');
    return this.moveMessage(accountId, mailbox, uid, archive);
  }

  async deleteMessage(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<{ deleted: true }> {
    await this.requireRow(accountId, mailbox, uid);
    const trash = await this.specialMailbox(accountId, '\\Trash');
    if (trash && trash !== mailbox) {
      await this.imap.moveMessage(accountId, mailbox, uid, trash);
    } else {
      await this.imap.deleteMessage(accountId, mailbox, uid);
    }
    await this.removeLocalMessage(accountId, mailbox, uid);
    return { deleted: true };
  }

  async sendMessage(
    accountId: string,
    input: SendMessageInput,
  ): Promise<SendMessageResult> {
    await this.accounts.get(accountId);
    const normalized = this.normalizeSendInput(input);
    const result = await this.smtp.send(accountId, normalized);
    const sentMailbox = await this.specialMailbox(accountId, '\\Sent') ?? null;
    if (sentMailbox) {
      try {
        await this.imap.appendMessage(accountId, sentMailbox, result.raw, ['\\Seen']);
      } catch (error) {
        console.warn('[backend:mail] Не удалось сохранить копию в «Отправленные»', {
          accountId,
          mailbox: sentMailbox,
          error: this.message(error),
        });
      }
    }
    return {
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
      sentMailbox,
    };
  }

  private normalizeSendInput(input: SendMessageInput): SendMessageInput {
    const to = this.parseAddresses(input.to, 'to');
    if (to.length === 0) {
      throw new BadRequestException('Укажите хотя бы одного получателя');
    }
    const cc = this.parseAddresses(input.cc ?? [], 'cc');
    const bcc = this.parseAddresses(input.bcc ?? [], 'bcc');
    if (to.length + cc.length + bcc.length > 50) {
      throw new BadRequestException('Слишком много получателей (максимум 50)');
    }
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    const text = typeof input.text === 'string' ? input.text : '';
    if (!text.trim() && !subject) {
      throw new BadRequestException('Укажите тему или текст письма');
    }
    return {
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      subject,
      text,
      inReplyTo: optionalHeader(input.inReplyTo),
      references: optionalHeader(input.references),
    };
  }

  private parseAddresses(value: string[] | string, field: string): string[] {
    const items = Array.isArray(value)
      ? value.flatMap((item) => item.split(/[,;]+/))
      : String(value).split(/[,;]+/);
    const addresses = [...new Set(
      items.map((item) => item.trim()).filter(Boolean),
    )];
    for (const address of addresses) {
      if (!EMAIL_PATTERN.test(address)) {
        throw new BadRequestException(`Некорректный адрес в поле ${field}: ${address}`);
      }
    }
    return addresses;
  }

  private findRow(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<MessageRow | undefined> {
    return this.repository.findMessage(accountId, mailbox, uid);
  }

  private async requireRow(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<MessageRow> {
    const row = await this.findRow(accountId, mailbox, uid);
    if (!row) {
      throw new NotFoundException(`Письмо с UID ${uid} отсутствует в локальной базе`);
    }
    return row;
  }

  private specialMailbox(accountId: string, specialUse: string): Promise<string | undefined> {
    return this.repository.specialMailbox(accountId, specialUse);
  }

  private async removeLocalMessage(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<void> {
    await this.repository.removeMessage(accountId, mailbox, uid);
  }

  private mapRow(row: MessageRow, includeBody: boolean): MessageRecord {
    return {
      accountId: row.account_id, mailbox: row.mailbox, uid: row.uid,
      subject: row.subject,
      from: { name: row.sender_name, address: row.sender_address },
      date: row.received_at, flags: JSON.parse(row.flags) as string[], size: row.size,
      tags: row.tags,
      messageId: row.message_id,
      inReplyTo: row.in_reply_to,
      references: parseMessageIds(row.references_header),
      threadId: row.thread_id,
      body: includeBody ? { text: row.body_text, html: row.body_html } : null,
    };
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Неизвестная ошибка IMAP';
  }
}

function optionalHeader(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function fillDays(
  rows: Array<{ date: string; count: number }>,
  since: Date,
  days: number,
): Array<{ date: string; count: number }> {
  const counts = new Map(rows.map((row) => [row.date, row.count]));
  return Array.from({ length: days }, (_, index) => {
    const date = addUtcDays(since, index).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
}
