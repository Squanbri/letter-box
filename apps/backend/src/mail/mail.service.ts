import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { DatabaseService } from '../database/database.service';
import { ImapService } from './imap.service';
import { MessageMetadata, MessageRecord } from './mail.types';

interface MessageRow {
  account_id: string;
  mailbox: string;
  uid: number;
  subject: string | null;
  sender_name: string | null;
  sender_address: string | null;
  received_at: string;
  flags: string;
  size: number;
  body_text: string | null;
  body_html: string | null;
  body_loaded_at: string | null;
}

@Injectable()
export class MailService {
  private readonly syncs = new Map<string, Promise<SyncResult>>();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ImapService) private readonly imap: ImapService,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  async connect(accountId: string): Promise<{ connected: true }> {
    try {
      await this.imap.testConnection(accountId);
      this.accounts.setStatus(accountId, 'connected');
      return { connected: true };
    } catch (error) {
      this.accounts.setStatus(accountId, 'error', this.message(error));
      throw error;
    }
  }

  syncInbox(accountId: string): Promise<SyncResult> {
    this.accounts.get(accountId);
    const running = this.syncs.get(accountId);
    if (running) return running;
    this.accounts.setStatus(accountId, 'syncing');
    const sync = this.performSync(accountId).finally(() => this.syncs.delete(accountId));
    this.syncs.set(accountId, sync);
    return sync;
  }

  private async performSync(accountId: string): Promise<SyncResult> {
    try {
      const db = this.database.db;
      const mailbox = 'INBOX';
      const currentState = db.prepare(
        'SELECT uid_validity FROM mailbox_state WHERE account_id = ? AND mailbox = ?',
      ).get(accountId, mailbox) as { uid_validity: string } | undefined;
      const knownUids = db.prepare(
        'SELECT uid FROM messages WHERE account_id = ? AND mailbox = ? ORDER BY uid',
      ).all(accountId, mailbox) as Array<{ uid: number }>;
      const result = await this.imap.fetchChanges(
        accountId,
        knownUids.map((row) => row.uid),
        currentState?.uid_validity,
      );

      const removed = db.transaction((messages: MessageMetadata[]) => {
        let removedCount = 0;
        if (result.reset) {
          removedCount += db.prepare(
            'DELETE FROM messages WHERE account_id = ? AND mailbox = ?',
          ).run(accountId, mailbox).changes;
        }
        db.prepare(`
          INSERT INTO mailbox_state (account_id, mailbox, uid_validity) VALUES (?, ?, ?)
          ON CONFLICT(account_id, mailbox) DO UPDATE SET uid_validity = excluded.uid_validity
        `).run(accountId, mailbox, result.uidValidity);
        const upsert = db.prepare(`
          INSERT INTO messages (
            account_id, mailbox, uid, subject, sender_name, sender_address,
            received_at, flags, size
          ) VALUES (
            @accountId, @mailbox, @uid, @subject, @senderName, @senderAddress,
            @date, @flags, @size
          )
          ON CONFLICT(account_id, mailbox, uid) DO UPDATE SET
            subject = excluded.subject, sender_name = excluded.sender_name,
            sender_address = excluded.sender_address, received_at = excluded.received_at,
            flags = excluded.flags, size = excluded.size
        `);
        for (const message of messages) {
          upsert.run({
            ...message, accountId, mailbox, flags: JSON.stringify(message.flags),
          });
        }
        const updateFlags = db.prepare(`
          UPDATE messages SET flags = ?
          WHERE account_id = ? AND mailbox = ? AND uid = ?
        `);
        for (const update of result.flagUpdates) {
          updateFlags.run(JSON.stringify(update.flags), accountId, mailbox, update.uid);
        }
        const serverUids = new Set(result.serverUids);
        const localUids = db.prepare(
          'SELECT uid FROM messages WHERE account_id = ? AND mailbox = ?',
        ).all(accountId, mailbox) as Array<{ uid: number }>;
        const remove = db.prepare(
          'DELETE FROM messages WHERE account_id = ? AND mailbox = ? AND uid = ?',
        );
        for (const row of localUids) {
          if (!serverUids.has(row.uid)) {
            removedCount += remove.run(accountId, mailbox, row.uid).changes;
          }
        }
        return removedCount;
      })(result.messages);
      this.accounts.markSynced(accountId);
      return {
        synced: result.messages.length + result.flagUpdates.length,
        added: result.messages.length,
        updated: result.flagUpdates.length,
        removed,
      };
    } catch (error) {
      this.accounts.setStatus(accountId, 'error', this.message(error));
      throw error;
    }
  }

  listMessages(accountId: string, mailbox = 'INBOX'): MessageRecord[] {
    this.accounts.get(accountId);
    const rows = this.database.db.prepare(
      'SELECT * FROM messages WHERE account_id = ? AND mailbox = ? ORDER BY received_at DESC',
    ).all(accountId, mailbox) as MessageRow[];
    return rows.map((row) => this.mapRow(row, false));
  }

  async getMessage(accountId: string, mailbox: string, uid: number): Promise<MessageRecord> {
    let row = this.findRow(accountId, mailbox, uid);
    if (!row) throw new NotFoundException(`Письмо с UID ${uid} отсутствует в локальной базе`);
    if (!row.body_loaded_at) {
      const body = await this.imap.fetchBody(accountId, uid);
      this.database.db.prepare(`
        UPDATE messages SET body_text = ?, body_html = ?, body_loaded_at = ?
        WHERE account_id = ? AND mailbox = ? AND uid = ?
      `).run(body.text, body.html, new Date().toISOString(), accountId, mailbox, uid);
      row = this.findRow(accountId, mailbox, uid)!;
    }
    return this.mapRow(row, true);
  }

  async setSeen(
    accountId: string,
    mailbox: string,
    uid: number,
    seen: boolean,
  ): Promise<MessageRecord> {
    const row = this.findRow(accountId, mailbox, uid);
    if (!row) {
      throw new NotFoundException(`Письмо с UID ${uid} отсутствует в локальной базе`);
    }
    await this.imap.setSeen(accountId, uid, seen);
    const flags = new Set(JSON.parse(row.flags) as string[]);
    if (seen) flags.add('\\Seen');
    else flags.delete('\\Seen');
    this.database.db.prepare(`
      UPDATE messages SET flags = ?
      WHERE account_id = ? AND mailbox = ? AND uid = ?
    `).run(JSON.stringify([...flags]), accountId, mailbox, uid);
    return this.mapRow(this.findRow(accountId, mailbox, uid)!, Boolean(row.body_loaded_at));
  }

  private findRow(accountId: string, mailbox: string, uid: number): MessageRow | undefined {
    return this.database.db.prepare(
      'SELECT * FROM messages WHERE account_id = ? AND mailbox = ? AND uid = ?',
    ).get(accountId, mailbox, uid) as MessageRow | undefined;
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

export interface SyncResult {
  synced: number;
  added: number;
  updated: number;
  removed: number;
}
