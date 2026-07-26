import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ImapService } from './imap.service';
import { MessageMetadata, MessageRecord } from './mail.types';

interface MessageRow {
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
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ImapService) private readonly imap: ImapService,
  ) {}

  async connect(): Promise<{ connected: true }> {
    await this.imap.testConnection();
    return { connected: true };
  }

  async syncInbox(): Promise<{ synced: number }> {
    const result = await this.imap.fetchMetadata();
    const db = this.database.db;
    const currentState = db
      .prepare('SELECT uid_validity FROM mailbox_state WHERE mailbox = ?')
      .get('INBOX') as { uid_validity: string } | undefined;

    const save = db.transaction((messages: MessageMetadata[]) => {
      if (currentState && currentState.uid_validity !== result.uidValidity) {
        db.prepare('DELETE FROM messages').run();
      }

      db.prepare(`
        INSERT INTO mailbox_state (mailbox, uid_validity)
        VALUES ('INBOX', ?)
        ON CONFLICT(mailbox) DO UPDATE SET uid_validity = excluded.uid_validity
      `).run(result.uidValidity);

      const upsert = db.prepare(`
        INSERT INTO messages (
          uid, subject, sender_name, sender_address, received_at, flags, size
        ) VALUES (
          @uid, @subject, @senderName, @senderAddress, @date, @flags, @size
        )
        ON CONFLICT(uid) DO UPDATE SET
          subject = excluded.subject,
          sender_name = excluded.sender_name,
          sender_address = excluded.sender_address,
          received_at = excluded.received_at,
          flags = excluded.flags,
          size = excluded.size
      `);

      for (const message of messages) {
        upsert.run({ ...message, flags: JSON.stringify(message.flags) });
      }

      if (messages.length === 0) {
        db.prepare('DELETE FROM messages').run();
      } else {
        const serverUids = new Set(messages.map((message) => message.uid));
        const localUids = db.prepare('SELECT uid FROM messages').all() as Array<{ uid: number }>;
        const remove = db.prepare('DELETE FROM messages WHERE uid = ?');
        for (const row of localUids) {
          if (!serverUids.has(row.uid)) {
            remove.run(row.uid);
          }
        }
      }
    });

    save(result.messages);
    return { synced: result.messages.length };
  }

  listMessages(): MessageRecord[] {
    const rows = this.database.db
      .prepare('SELECT * FROM messages ORDER BY received_at DESC')
      .all() as MessageRow[];
    return rows.map((row) => this.mapRow(row, false));
  }

  async getMessage(uid: number): Promise<MessageRecord> {
    let row = this.findRow(uid);
    if (!row) {
      throw new NotFoundException(`Письмо с UID ${uid} отсутствует в локальной базе`);
    }

    if (!row.body_loaded_at) {
      const body = await this.imap.fetchBody(uid);
      this.database.db
        .prepare(`
          UPDATE messages
          SET body_text = ?, body_html = ?, body_loaded_at = ?
          WHERE uid = ?
        `)
        .run(body.text, body.html, new Date().toISOString(), uid);
      row = this.findRow(uid)!;
    }

    return this.mapRow(row, true);
  }

  private findRow(uid: number): MessageRow | undefined {
    return this.database.db
      .prepare('SELECT * FROM messages WHERE uid = ?')
      .get(uid) as MessageRow | undefined;
  }

  private mapRow(row: MessageRow, includeBody: boolean): MessageRecord {
    return {
      uid: row.uid,
      subject: row.subject,
      from: { name: row.sender_name, address: row.sender_address },
      date: row.received_at,
      flags: JSON.parse(row.flags) as string[],
      size: row.size,
      body: includeBody
        ? { text: row.body_text, html: row.body_html }
        : null,
    };
  }
}
