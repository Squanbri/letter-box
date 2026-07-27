import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type {
  ClassificationPreparation,
  ClassificationStatus,
  MailboxChanges,
  MessageMetadata,
} from './mail.types';
import type { MailboxRecord } from '@letter-box/contracts';

export interface MessageRow {
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
  classification_text: string | null;
  classification_status: ClassificationStatus;
  classified_at: string | null;
}

@Injectable()
export class MailRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async mailboxState(accountId: string, mailbox: string): Promise<string | undefined> {
    return (this.database.db.prepare(
      'SELECT uid_validity FROM mailbox_state WHERE account_id = ? AND mailbox = ?',
    ).get(accountId, mailbox) as { uid_validity: string } | undefined)?.uid_validity;
  }

  async knownUids(accountId: string, mailbox: string): Promise<number[]> {
    return (this.database.db.prepare(
      'SELECT uid FROM messages WHERE account_id = ? AND mailbox = ? ORDER BY uid',
    ).all(accountId, mailbox) as Array<{ uid: number }>).map((row) => row.uid);
  }

  async applyChanges(
    accountId: string,
    mailbox: string,
    result: MailboxChanges,
  ): Promise<number> {
    const db = this.database.db;
    return db.transaction(() => {
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
      const upsert = this.messageUpsert();
      for (const message of result.messages) {
        upsert.run(this.messageParams(accountId, mailbox, message));
      }
      const updateFlags = db.prepare(`
        UPDATE messages SET flags = ?
        WHERE account_id = ? AND mailbox = ? AND uid = ?
      `);
      for (const update of result.flagUpdates) {
        updateFlags.run(JSON.stringify(update.flags), accountId, mailbox, update.uid);
      }
      this.saveClassificationPreparationsInTransaction(
        accountId,
        mailbox,
        result.classificationPreparations ?? [],
      );
      const serverUids = new Set(result.serverUids);
      const localUids = (db.prepare(
        'SELECT uid FROM messages WHERE account_id = ? AND mailbox = ?',
      ).all(accountId, mailbox) as Array<{ uid: number }>).map((row) => row.uid);
      const remove = db.prepare(
        'DELETE FROM messages WHERE account_id = ? AND mailbox = ? AND uid = ?',
      );
      for (const uid of localUids) {
        if (!serverUids.has(uid)) {
          removedCount += remove.run(accountId, mailbox, uid).changes;
        }
      }
      return removedCount;
    })();
  }

  async listMessages(
    accountId: string,
    mailbox: string,
    limit: number,
    offset: number,
  ): Promise<MessageRow[]> {
    return this.database.db.prepare(
      `SELECT * FROM messages
       WHERE account_id = ? AND mailbox = ?
       ORDER BY received_at DESC, uid DESC LIMIT ? OFFSET ?`,
    ).all(accountId, mailbox, limit, offset) as MessageRow[];
  }

  async listMailboxes(accountId: string): Promise<MailboxRecord[]> {
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
    return rows.map((row) => ({
      path: row.path,
      name: row.name,
      delimiter: row.delimiter,
      specialUse: row.special_use,
      totalCount: row.total_count,
      unreadCount: row.unread_count,
    }));
  }

  async replaceMailboxes(accountId: string, mailboxes: MailboxRecord[]): Promise<void> {
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
          accountId, mailbox.path, mailbox.name, mailbox.delimiter,
          mailbox.specialUse, mailbox.totalCount, mailbox.unreadCount, now,
        );
      }
      const paths = new Set(mailboxes.map((mailbox) => mailbox.path));
      const stored = db.prepare(
        'SELECT path FROM mailboxes WHERE account_id = ?',
      ).all(accountId) as Array<{ path: string }>;
      const remove = db.prepare('DELETE FROM mailboxes WHERE account_id = ? AND path = ?');
      for (const row of stored) {
        if (!paths.has(row.path)) remove.run(accountId, row.path);
      }
    })();
  }

  async saveMessages(
    accountId: string,
    mailbox: string,
    messages: MessageMetadata[],
  ): Promise<void> {
    const upsert = this.messageUpsert();
    this.database.db.transaction(() => {
      for (const message of messages) {
        upsert.run(this.messageParams(accountId, mailbox, message));
      }
    })();
  }

  async findMessage(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<MessageRow | undefined> {
    return this.database.db.prepare(
      'SELECT * FROM messages WHERE account_id = ? AND mailbox = ? AND uid = ?',
    ).get(accountId, mailbox, uid) as MessageRow | undefined;
  }

  async classificationCandidateUids(
    accountId: string,
    mailbox: string,
  ): Promise<number[]> {
    const rows = this.database.db.prepare(`
      SELECT uid, flags FROM messages
      WHERE account_id = ? AND mailbox = ? AND classification_text IS NULL
      ORDER BY uid
    `).all(accountId, mailbox) as Array<{ uid: number; flags: string }>;
    return rows
      .filter(({ flags }) => !(JSON.parse(flags) as string[]).includes('\\Seen'))
      .map(({ uid }) => uid);
  }

  async saveClassificationPreparations(
    accountId: string,
    mailbox: string,
    preparations: ClassificationPreparation[],
  ): Promise<void> {
    this.database.db.transaction(() => {
      this.saveClassificationPreparationsInTransaction(accountId, mailbox, preparations);
    })();
  }

  async saveBody(
    accountId: string,
    mailbox: string,
    uid: number,
    body: { text: string | null; html: string | null },
    loadedAt: string,
  ): Promise<void> {
    this.database.db.prepare(`
      UPDATE messages SET body_text = ?, body_html = ?, body_loaded_at = ?
      WHERE account_id = ? AND mailbox = ? AND uid = ?
    `).run(body.text, body.html, loadedAt, accountId, mailbox, uid);
  }

  async saveFlags(
    accountId: string,
    mailbox: string,
    uid: number,
    flags: string[],
  ): Promise<void> {
    this.database.db.prepare(`
      UPDATE messages SET flags = ?
      WHERE account_id = ? AND mailbox = ? AND uid = ?
    `).run(JSON.stringify(flags), accountId, mailbox, uid);
  }

  async hasMailbox(accountId: string, mailbox: string): Promise<boolean> {
    return Boolean(this.database.db.prepare(
      'SELECT 1 FROM mailboxes WHERE account_id = ? AND path = ?',
    ).get(accountId, mailbox));
  }

  async specialMailbox(accountId: string, specialUse: string): Promise<string | undefined> {
    return (this.database.db.prepare(
      'SELECT path FROM mailboxes WHERE account_id = ? AND special_use = ?',
    ).get(accountId, specialUse) as { path: string } | undefined)?.path;
  }

  async removeMessage(accountId: string, mailbox: string, uid: number): Promise<void> {
    this.database.db.prepare(
      'DELETE FROM messages WHERE account_id = ? AND mailbox = ? AND uid = ?',
    ).run(accountId, mailbox, uid);
  }

  private messageUpsert() {
    return this.database.db.prepare(`
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
  }

  private messageParams(accountId: string, mailbox: string, message: MessageMetadata) {
    return { ...message, accountId, mailbox, flags: JSON.stringify(message.flags) };
  }

  private saveClassificationPreparationsInTransaction(
    accountId: string,
    mailbox: string,
    preparations: ClassificationPreparation[],
  ): void {
    const update = this.database.db.prepare(`
      UPDATE messages
      SET classification_text = ?, classification_status = ?
      WHERE account_id = ? AND mailbox = ? AND uid = ?
        AND classification_text IS NULL
    `);
    for (const preparation of preparations) {
      update.run(
        preparation.text,
        preparation.status,
        accountId,
        mailbox,
        preparation.uid,
      );
    }
  }
}
