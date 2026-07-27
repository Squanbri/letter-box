import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { ImapService } from './imap.service';
import { MailboxRecord, MessageRecord, MessageRow } from './mail.types';
import type { SyncResult } from '@letter-box/contracts';
import { EventsGateway } from '../events/events.gateway';
import {
  MAIL_REPOSITORY,
  MailRepositoryContract,
} from '../database/repository.contracts';
export type { SyncResult } from '@letter-box/contracts';

@Injectable()
export class MailService {
  private readonly syncs = new Map<string, {
    mailbox: string;
    promise: Promise<SyncResult>;
  }>();

  constructor(
    @Inject(MAIL_REPOSITORY) private readonly repository: MailRepositoryContract,
    @Inject(ImapService) private readonly imap: ImapService,
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
  ): Promise<MessageRecord[]> {
    await this.accounts.get(accountId);
    const rows = await this.repository.listMessages(
      accountId,
      mailbox,
      Math.min(Math.max(limit, 1), 100),
      Math.max(offset, 0),
    );
    return rows.map((row) => this.mapRow(row, false));
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
    if (!row.body_loaded_at) {
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
      body: includeBody ? { text: row.body_text, html: row.body_html } : null,
    };
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Неизвестная ошибка IMAP';
  }
}
