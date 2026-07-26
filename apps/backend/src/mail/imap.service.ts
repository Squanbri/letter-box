import {
  BadGatewayException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ImapFlow, type FetchMessageObject, type ImapFlowOptions } from 'imapflow';
import { simpleParser } from 'mailparser';
import { MailboxChanges, MessageFlags, MessageMetadata } from './mail.types';
import { AccountService } from '../account/account.service';

@Injectable()
export class ImapService {
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

  async testConnection(accountId: string): Promise<void> {
    await this.withInbox(accountId, async () => undefined);
  }

  async fetchChanges(
    accountId: string,
    knownUids: number[],
    expectedUidValidity?: string,
    initialLimit = 500,
  ): Promise<MailboxChanges> {
    return this.withInbox(accountId, async (client) => {
      if (!client.mailbox) {
        throw new BadGatewayException('Папка INBOX не открыта');
      }
      const uidValidity = String(client.mailbox.uidValidity);
      const reset = Boolean(expectedUidValidity && expectedUidValidity !== uidValidity);
      const serverUids = await client.search({ all: true }, { uid: true }) || [];
      const effectiveKnown = reset ? [] : knownUids;
      const knownSet = new Set(effectiveKnown);
      const newUids = selectMetadataUids(
        serverUids,
        effectiveKnown,
        initialLimit,
      );
      const messages: MessageMetadata[] = [];
      if (newUids.length > 0) {
        for await (const message of client.fetch(
          newUids,
          { uid: true, envelope: true, flags: true, size: true },
          { uid: true },
        )) {
          messages.push(this.toMetadata(message));
        }
      }
      const existingUids = serverUids.filter((uid) => knownSet.has(uid));
      const flagUpdates: MessageFlags[] = [];
      if (existingUids.length > 0) {
        for await (const message of client.fetch(
          existingUids,
          { uid: true, flags: true },
          { uid: true },
        )) {
          flagUpdates.push({
            uid: message.uid,
            flags: Array.from(message.flags ?? []),
          });
        }
      }
      return { uidValidity, reset, serverUids, messages, flagUpdates };
    });
  }

  async fetchBody(accountId: string, uid: number): Promise<{ text: string | null; html: string | null }> {
    return this.withInbox(accountId, async (client) => {
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

  private async withInbox<T>(
    accountId: string,
    operation: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = new ImapFlow(this.options(accountId));

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
      const account = this.accounts.getConfig(accountId);
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка IMAP';
      const diagnostics = this.errorDiagnostics(error);
      console.warn('[backend:imap] Ошибка подключения', {
        provider: account?.provider,
        host: account?.host,
        user: account ? this.maskEmail(account.email) : undefined,
        ...diagnostics,
      });

      if (
        account?.provider === 'yandex'
        && this.isAuthenticationError(error, message)
      ) {
        throw new BadGatewayException(
          'Яндекс отклонил вход. Проверьте, что IMAP включён в настройках Почты, '
          + 'используется пароль приложения типа «Почта» и он уже успел активироваться.',
        );
      }

      throw new BadGatewayException(`Ошибка IMAP: ${message}`);
    } finally {
      if (client.usable) {
        await client.logout().catch(() => undefined);
      }
    }
  }

  private options(accountId: string): ImapFlowOptions {
    const account = this.accounts.getConfig(accountId);

    return {
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: { user: this.imapUsername(account), pass: account.password },
      logger: false,
    };
  }

  private imapUsername(account: {
    provider: 'mailru' | 'yandex';
    email: string;
  }): string {
    if (account.provider !== 'yandex') {
      return account.email;
    }

    const [localPart, domain] = account.email.split('@');
    return localPart && ['yandex.ru', 'ya.ru'].includes(domain?.toLowerCase())
      ? localPart
      : account.email;
  }

  private isAuthenticationError(error: unknown, message: string): boolean {
    const record = error as Record<string, unknown> | null;
    return record?.authenticationFailed === true
      || /auth|login|credential|password|парол/i.test(
        `${message} ${String(record?.responseText ?? '')}`,
      );
  }

  private errorDiagnostics(error: unknown): Record<string, unknown> {
    const record = error as Record<string, unknown> | null;
    return {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
      code: record?.code,
      responseStatus: record?.responseStatus,
      responseText: record?.responseText,
      authenticationFailed: record?.authenticationFailed,
    };
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    return domain ? `${localPart.slice(0, 2)}***@${domain}` : '***';
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

export function selectMetadataUids(
  serverUids: number[],
  knownUids: number[],
  limit: number,
): number[] {
  if (knownUids.length === 0) {
    return serverUids.slice(-limit);
  }
  const highestKnownUid = knownUids.reduce((highest, uid) => Math.max(highest, uid), 0);
  return serverUids.filter((uid) => uid > highestKnownUid).slice(0, limit);
}
