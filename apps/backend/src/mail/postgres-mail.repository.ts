import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import type { MailboxRecord } from '@letter-box/contracts';
import { PostgresDatabaseService } from '../database/postgres-database.service';
import type { MailboxChanges, MessageMetadata } from './mail.types';
import type { MessageRow } from './mail.repository';

interface UidRow extends QueryResultRow {
  uid: string;
}

interface MailboxRow extends QueryResultRow {
  path: string;
  name: string;
  delimiter: string;
  special_use: string | null;
  total_count: number;
  unread_count: number;
}

interface PostgresMessageRow extends QueryResultRow {
  account_id: string;
  mailbox: string;
  uid: string;
  subject: string | null;
  sender_name: string | null;
  sender_address: string | null;
  received_at: Date | string;
  flags: string[];
  size: string;
  body_text: string | null;
  body_html: string | null;
  body_loaded_at: Date | string | null;
}

@Injectable()
export class PostgresMailRepository {
  constructor(
    @Inject(PostgresDatabaseService)
    private readonly database: PostgresDatabaseService,
  ) {}

  async mailboxState(accountId: string, mailbox: string): Promise<string | undefined> {
    const result = await this.database.query<{ uid_validity: string } & QueryResultRow>(
      `SELECT uid_validity FROM mailbox_state
       WHERE account_id = $1 AND mailbox = $2`,
      [accountId, mailbox],
    );
    return result.rows[0]?.uid_validity;
  }

  async knownUids(accountId: string, mailbox: string): Promise<number[]> {
    const result = await this.database.query<UidRow>(
      `SELECT uid FROM messages
       WHERE account_id = $1 AND mailbox = $2 ORDER BY uid`,
      [accountId, mailbox],
    );
    return result.rows.map((row) => Number(row.uid));
  }

  async applyChanges(
    accountId: string,
    mailbox: string,
    changes: MailboxChanges,
  ): Promise<number> {
    return this.database.transaction(async (client) => {
      let removed = 0;
      if (changes.reset) {
        const deletion = await client.query(
          'DELETE FROM messages WHERE account_id = $1 AND mailbox = $2',
          [accountId, mailbox],
        );
        removed += deletion.rowCount ?? 0;
      }
      await client.query(`
        INSERT INTO mailbox_state (account_id, mailbox, uid_validity)
        VALUES ($1, $2, $3)
        ON CONFLICT(account_id, mailbox) DO UPDATE
        SET uid_validity = excluded.uid_validity
      `, [accountId, mailbox, changes.uidValidity]);

      for (const message of changes.messages) {
        await this.upsertMessage(client, accountId, mailbox, message);
      }
      for (const update of changes.flagUpdates) {
        await client.query(
          `UPDATE messages SET flags = $1::jsonb
           WHERE account_id = $2 AND mailbox = $3 AND uid = $4`,
          [JSON.stringify(update.flags), accountId, mailbox, update.uid],
        );
      }

      const serverUids = new Set(changes.serverUids);
      const local = await client.query<UidRow>(
        'SELECT uid FROM messages WHERE account_id = $1 AND mailbox = $2',
        [accountId, mailbox],
      );
      for (const row of local.rows) {
        const uid = Number(row.uid);
        if (serverUids.has(uid)) continue;
        const deletion = await client.query(
          `DELETE FROM messages
           WHERE account_id = $1 AND mailbox = $2 AND uid = $3`,
          [accountId, mailbox, uid],
        );
        removed += deletion.rowCount ?? 0;
      }
      return removed;
    });
  }

  async listMessages(
    accountId: string,
    mailbox: string,
    limit: number,
    offset: number,
  ): Promise<MessageRow[]> {
    const result = await this.database.query<PostgresMessageRow>(
      `SELECT * FROM messages
       WHERE account_id = $1 AND mailbox = $2
       ORDER BY received_at DESC, uid DESC LIMIT $3 OFFSET $4`,
      [accountId, mailbox, limit, offset],
    );
    return result.rows.map((row) => this.normalizeMessage(row));
  }

  async listMailboxes(accountId: string): Promise<MailboxRecord[]> {
    const result = await this.database.query<MailboxRow>(`
      SELECT path, name, delimiter, special_use, total_count, unread_count
      FROM mailboxes WHERE account_id = $1
      ORDER BY CASE special_use
        WHEN '\\Inbox' THEN 0 WHEN '\\Sent' THEN 1 WHEN '\\Drafts' THEN 2
        WHEN '\\Junk' THEN 3 WHEN '\\Trash' THEN 4 ELSE 5 END, name
    `, [accountId]);
    return result.rows.map((row) => ({
      path: row.path,
      name: row.name,
      delimiter: row.delimiter,
      specialUse: row.special_use,
      totalCount: row.total_count,
      unreadCount: row.unread_count,
    }));
  }

  async replaceMailboxes(accountId: string, mailboxes: MailboxRecord[]): Promise<void> {
    await this.database.transaction(async (client) => {
      const now = new Date().toISOString();
      for (const mailbox of mailboxes) {
        await client.query(`
          INSERT INTO mailboxes (
            account_id, path, name, delimiter, special_use,
            total_count, unread_count, listed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT(account_id, path) DO UPDATE SET
            name = excluded.name,
            delimiter = excluded.delimiter,
            special_use = excluded.special_use,
            total_count = excluded.total_count,
            unread_count = excluded.unread_count,
            listed_at = excluded.listed_at
        `, [
          accountId, mailbox.path, mailbox.name, mailbox.delimiter,
          mailbox.specialUse, mailbox.totalCount, mailbox.unreadCount, now,
        ]);
      }
      const stored = await client.query<{ path: string } & QueryResultRow>(
        'SELECT path FROM mailboxes WHERE account_id = $1',
        [accountId],
      );
      const paths = new Set(mailboxes.map((mailbox) => mailbox.path));
      for (const row of stored.rows) {
        if (paths.has(row.path)) continue;
        await client.query(
          'DELETE FROM mailboxes WHERE account_id = $1 AND path = $2',
          [accountId, row.path],
        );
      }
    });
  }

  async saveMessages(
    accountId: string,
    mailbox: string,
    messages: MessageMetadata[],
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      for (const message of messages) {
        await this.upsertMessage(client, accountId, mailbox, message);
      }
    });
  }

  async findMessage(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<MessageRow | undefined> {
    const result = await this.database.query<PostgresMessageRow>(
      `SELECT * FROM messages
       WHERE account_id = $1 AND mailbox = $2 AND uid = $3`,
      [accountId, mailbox, uid],
    );
    return result.rows[0] ? this.normalizeMessage(result.rows[0]) : undefined;
  }

  async saveBody(
    accountId: string,
    mailbox: string,
    uid: number,
    body: { text: string | null; html: string | null },
    loadedAt: string,
  ): Promise<void> {
    await this.database.query(
      `UPDATE messages
       SET body_text = $1, body_html = $2, body_loaded_at = $3
       WHERE account_id = $4 AND mailbox = $5 AND uid = $6`,
      [body.text, body.html, loadedAt, accountId, mailbox, uid],
    );
  }

  async saveFlags(
    accountId: string,
    mailbox: string,
    uid: number,
    flags: string[],
  ): Promise<void> {
    await this.database.query(
      `UPDATE messages SET flags = $1::jsonb
       WHERE account_id = $2 AND mailbox = $3 AND uid = $4`,
      [JSON.stringify(flags), accountId, mailbox, uid],
    );
  }

  async hasMailbox(accountId: string, mailbox: string): Promise<boolean> {
    const result = await this.database.query(
      'SELECT 1 FROM mailboxes WHERE account_id = $1 AND path = $2',
      [accountId, mailbox],
    );
    return result.rowCount === 1;
  }

  async specialMailbox(accountId: string, specialUse: string): Promise<string | undefined> {
    const result = await this.database.query<{ path: string } & QueryResultRow>(
      `SELECT path FROM mailboxes
       WHERE account_id = $1 AND special_use = $2`,
      [accountId, specialUse],
    );
    return result.rows[0]?.path;
  }

  async removeMessage(accountId: string, mailbox: string, uid: number): Promise<void> {
    await this.database.query(
      `DELETE FROM messages
       WHERE account_id = $1 AND mailbox = $2 AND uid = $3`,
      [accountId, mailbox, uid],
    );
  }

  private upsertMessage(
    client: PoolClient,
    accountId: string,
    mailbox: string,
    message: MessageMetadata,
  ): Promise<unknown> {
    return client.query(`
      INSERT INTO messages (
        account_id, mailbox, uid, subject, sender_name, sender_address,
        received_at, flags, size
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      ON CONFLICT(account_id, mailbox, uid) DO UPDATE SET
        subject = excluded.subject,
        sender_name = excluded.sender_name,
        sender_address = excluded.sender_address,
        received_at = excluded.received_at,
        flags = excluded.flags,
        size = excluded.size
    `, [
      accountId, mailbox, message.uid, message.subject, message.senderName,
      message.senderAddress, message.date, JSON.stringify(message.flags), message.size,
    ]);
  }

  private normalizeMessage(row: PostgresMessageRow): MessageRow {
    return {
      ...row,
      uid: Number(row.uid),
      size: Number(row.size),
      received_at: this.iso(row.received_at)!,
      body_loaded_at: this.iso(row.body_loaded_at),
      flags: JSON.stringify(row.flags),
    };
  }

  private iso(value: Date | string | null): string | null {
    if (value === null) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
