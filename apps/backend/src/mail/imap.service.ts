import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ImapFlow, type FetchMessageObject, type ImapFlowOptions } from 'imapflow';
import { simpleParser } from 'mailparser';
import { MessageMetadata } from './mail.types';

@Injectable()
export class ImapService {
  async testConnection(): Promise<void> {
    await this.withInbox(async () => undefined);
  }

  async fetchMetadata(): Promise<{
    uidValidity: string;
    messages: MessageMetadata[];
  }> {
    return this.withInbox(async (client) => {
      const messages: MessageMetadata[] = [];

      for await (const message of client.fetch(
        '1:*',
        { uid: true, envelope: true, flags: true, size: true },
      )) {
        messages.push(this.toMetadata(message));
      }

      if (!client.mailbox) {
        throw new BadGatewayException('Папка INBOX не открыта');
      }

      return {
        uidValidity: String(client.mailbox.uidValidity),
        messages,
      };
    });
  }

  async fetchBody(uid: number): Promise<{ text: string | null; html: string | null }> {
    return this.withInbox(async (client) => {
      const message = await client.fetchOne(uid, { source: true }, { uid: true });

      if (!message || !message.source) {
        throw new BadGatewayException(`Письмо с UID ${uid} не найдено на IMAP-сервере`);
      }

      const parsed = await simpleParser(message.source);
      return {
        text: parsed.text || null,
        html: typeof parsed.html === 'string' ? parsed.html : null,
      };
    });
  }

  private async withInbox<T>(operation: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow(this.options());

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        return await operation(client);
      } finally {
        lock.release();
      }
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка IMAP';
      throw new BadGatewayException(`Ошибка IMAP: ${message}`);
    } finally {
      if (client.usable) {
        await client.logout().catch(() => undefined);
      }
    }
  }

  private options(): ImapFlowOptions {
    const host = process.env.IMAP_HOST;
    const user = process.env.IMAP_USER;
    const pass = process.env.IMAP_PASSWORD;

    if (!host || !user || !pass) {
      throw new InternalServerErrorException(
        'Не заданы IMAP_HOST, IMAP_USER или IMAP_PASSWORD',
      );
    }

    return {
      host,
      port: Number(process.env.IMAP_PORT ?? 993),
      secure: process.env.IMAP_SECURE !== 'false',
      auth: { user, pass },
      logger: false,
    };
  }

  private toMetadata(message: FetchMessageObject): MessageMetadata {
    const sender = message.envelope?.from?.[0];
    return {
      uid: message.uid,
      subject: message.envelope?.subject ?? null,
      senderName: sender?.name ?? null,
      senderAddress: sender?.address ?? null,
      date: (message.envelope?.date ?? new Date(0)).toISOString(),
      flags: Array.from(message.flags ?? []),
      size: message.size ?? 0,
    };
  }
}
