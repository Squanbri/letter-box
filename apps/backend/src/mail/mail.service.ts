import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { DatabaseService } from '../database/database.service';
import { ImapService } from './imap.service';
import { MailboxRecord, MessageMetadata, MessageRecord } from './mail.types';

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
  private readonly syncs = new Map<string, {
    mailbox: string;
    promise: Promise<SyncResult>;
  }>();

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

  syncMailbox(accountId: string, mailbox = 'INBOX'): Promise<SyncResult> {
    this.accounts.get(accountId);
    const syncKey = `${accountId}\0${mailbox}`;
    const running = this.syncs.get(syncKey);
    if (running) return running.promise;
    this.accounts.setStatus(accountId, 'syncing');
    const sync = this.performSync(accountId, mailbox).finally(() => this.syncs.delete(syncKey));
    this.syncs.set(syncKey, { mailbox, promise: sync });
    return sync;
  }

  private async performSync(accountId: string, mailbox: string): Promise<SyncResult> {
    try {
      const db = this.database.db;
      const currentState = db.prepare(
        'SELECT uid_validity FROM mailbox_state WHERE account_id = ? AND mailbox = ?',
      ).get(accountId, mailbox) as { uid_validity: string } | undefined;
      const knownUids = db.prepare(
        'SELECT uid FROM messages WHERE account_id = ? AND mailbox = ? ORDER BY uid',
      ).all(accountId, mailbox) as Array<{ uid: number }>;
      const result = await this.imap.fetchChanges(
        accountId,
        mailbox,
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

  listMessages(
    accountId: string,
    mailbox = 'INBOX',
    limit = 50,
    offset = 0,
  ): MessageRecord[] {
    this.accounts.get(accountId);
    const rows = this.database.db.prepare(
      `SELECT * FROM messages
       WHERE account_id = ? AND mailbox = ?
       ORDER BY received_at DESC, uid DESC LIMIT ? OFFSET ?`,
    ).all(accountId, mailbox, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)) as MessageRow[];
    return rows.map((row) => this.mapRow(row, false));
  }

  listMailboxes(accountId: string): MailboxRecord[] {
    this.accounts.get(accountId);
    const rows = this.database.db.prepare(`
      SELECT path, name, delimiter, special_use, total_count, unread_count
      FROM mailboxes WHERE account_id = ?
      ORDER BY CASE special_use
        WHEN '\\Inbox' THEN 0 WHEN '\\Sent' THEN 1 WHEN '\\Drafts' THEN 2
        WHEN '\\Junk' THEN 3 WHEN '\\Trash' THEN 4 ELSE 5 END, name
    `).all(accountId) as Array<{
      path: string;
      name: string;
      delimiter: string;
      special_use: string | null;
      total_count: number;
      unread_count: number;
    }>;
    return rows.length > 0
      ? rows.map((row) => ({
        path: row.path,
        name: row.name,
        delimiter: row.delimiter,
        specialUse: row.special_use,
        totalCount: row.total_count,
        unreadCount: row.unread_count,
      }))
      : [{
        path: 'INBOX', name: 'Входящие', delimiter: '/', specialUse: '\\Inbox',
        totalCount: 0, unreadCount: 0,
      }];
  }

  async syncMailboxes(accountId: string): Promise<MailboxRecord[]> {
    this.accounts.get(accountId);
    const mailboxes = await this.imap.fetchMailboxes(accountId);
    const db = this.database.db;
    db.transaction(() => {
      const save = db.prepare(`
        INSERT INTO mailboxes (
          account_id, path, name, delimiter, special_use,
          total_count, unread_count, listed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, path) DO UPDATE SET
          name = excluded.name, delimiter = excluded.delimiter,
          special_use = excluded.special_use, total_count = excluded.total_count,
          unread_count = excluded.unread_count, listed_at = excluded.listed_at
      `);
      const now = new Date().toISOString();
      for (const mailbox of mailboxes) {
        save.run(
          accountId,
          mailbox.path,
          mailbox.name,
          mailbox.delimiter,
          mailbox.specialUse,
          mailbox.totalCount,
          mailbox.unreadCount,
          now,
        );
      }
      const paths = new Set(mailboxes.map((mailbox) => mailbox.path));
      const stored = db.prepare(
        'SELECT path FROM mailboxes WHERE account_id = ?',
      ).all(accountId) as Array<{ path: string }>;
      const remove = db.prepare(
        'DELETE FROM mailboxes WHERE account_id = ? AND path = ?',
      );
      for (const row of stored) {
        if (!paths.has(row.path)) remove.run(accountId, row.path);
      }
    })();
    return this.listMailboxes(accountId);
  }

  async loadOlder(
    accountId: string,
    mailbox: string,
    beforeUid?: number,
  ): Promise<{ loaded: number }> {
    this.accounts.get(accountId);
    const messages = await this.imap.fetchOlderMetadata(
      accountId,
      mailbox,
      beforeUid,
      50,
    );
    const save = this.database.db.prepare(`
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
    this.database.db.transaction(() => {
      for (const message of messages) {
        save.run({
          ...message,
          accountId,
          mailbox,
          flags: JSON.stringify(message.flags),
        });
      }
    })();
    return { loaded: messages.length };
  }

  async getMessage(accountId: string, mailbox: string, uid: number): Promise<MessageRecord> {
    let row = this.findRow(accountId, mailbox, uid);
    if (!row) throw new NotFoundException(`Письмо с UID ${uid} отсутствует в локальной базе`);
    if (!row.body_loaded_at) {
      const body = await this.imap.fetchBody(accountId, mailbox, uid);
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
    await this.imap.setSeen(accountId, mailbox, uid, seen);
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
