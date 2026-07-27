import {
  BadGatewayException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ImapFlow, type FetchMessageObject, type ImapFlowOptions } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  MailboxChanges,
  MailboxRecord,
  ClassificationPreparation,
  MessageFlags,
  MessageMetadata,
} from './mail.types';
import { AccountService } from '../account/account.service';

@Injectable()
export class ImapService {
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

  async testConnection(accountId: string): Promise<void> {
    await this.withMailbox(accountId, 'INBOX', async () => undefined);
  }

  async fetchMailboxes(accountId: string): Promise<MailboxRecord[]> {
    return this.withClient(accountId, async (client) => {
      const mailboxes = await client.list({
        statusQuery: { messages: true, unseen: true },
      });
      return mailboxes
        .filter((mailbox) => mailbox.listed && !mailbox.flags.has('\\Noselect'))
        .map((mailbox) => ({
          path: mailbox.path,
          name: mailbox.name,
          delimiter: mailbox.delimiter,
          specialUse: mailbox.specialUse ?? null,
          totalCount: mailbox.status?.messages ?? 0,
          unreadCount: mailbox.status?.unseen ?? 0,
        }));
    });
  }

  async fetchChanges(
    accountId: string,
    mailbox: string,
    knownUids: number[],
    expectedUidValidity?: string,
    classificationCandidateUids: number[] = [],
    initialLimit = 50,
  ): Promise<MailboxChanges> {
    return this.withMailbox(accountId, mailbox, async (client) => {
      if (!client.mailbox) {
        throw new BadGatewayException(`Папка ${mailbox} не открыта`);
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
      const classificationUids = [...new Set([
        ...(reset ? [] : classificationCandidateUids),
        ...newUids,
      ])].filter((uid) => serverUids.includes(uid));
      const classificationPreparations = await this.fetchClassificationPreparations(
        client,
        classificationUids,
      );
      return {
        uidValidity,
        reset,
        serverUids,
        messages,
        flagUpdates,
        classificationPreparations,
      };
    });
  }

  async fetchOlderMetadata(
    accountId: string,
    mailbox: string,
    beforeUid: number | undefined,
    limit = 50,
  ): Promise<MessageMetadata[]> {
    return this.withMailbox(accountId, mailbox, async (client) => {
      const serverUids = await client.search({ all: true }, { uid: true }) || [];
      const candidates = beforeUid
        ? serverUids.filter((uid) => uid < beforeUid)
        : serverUids;
      const pageUids = candidates.slice(-limit);
      const messages: MessageMetadata[] = [];
      if (pageUids.length > 0) {
        for await (const message of client.fetch(
          pageUids,
          { uid: true, envelope: true, flags: true, size: true },
          { uid: true },
        )) {
          messages.push(this.toMetadata(message));
        }
      }
      return messages;
    });
  }

  async fetchBody(accountId: string, mailbox: string, uid: number): Promise<{ text: string | null; html: string | null }> {
    return this.withMailbox(accountId, mailbox, async (client) => {
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

  async setSeen(accountId: string, mailbox: string, uid: number, seen: boolean): Promise<void> {
    await this.withMailbox(accountId, mailbox, async (client) => {
      const update = seen
        ? client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        : client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
      if (!await update) {
        throw new BadGatewayException(`Не удалось обновить флаги письма с UID ${uid}`);
      }
    });
  }

  async setFlagged(
    accountId: string,
    mailbox: string,
    uid: number,
    flagged: boolean,
  ): Promise<void> {
    await this.withMailbox(accountId, mailbox, async (client) => {
      const update = flagged
        ? client.messageFlagsAdd(uid, ['\\Flagged'], { uid: true })
        : client.messageFlagsRemove(uid, ['\\Flagged'], { uid: true });
      if (!await update) {
        throw new BadGatewayException(`Не удалось обновить флаг письма с UID ${uid}`);
      }
    });
  }

  async moveMessage(
    accountId: string,
    mailbox: string,
    uid: number,
    destination: string,
  ): Promise<void> {
    await this.withMailbox(accountId, mailbox, async (client) => {
      if (!await client.messageMove(uid, destination, { uid: true })) {
        throw new BadGatewayException(`Не удалось переместить письмо с UID ${uid}`);
      }
    });
  }

  async deleteMessage(accountId: string, mailbox: string, uid: number): Promise<void> {
    await this.withMailbox(accountId, mailbox, async (client) => {
      if (!await client.messageDelete(uid, { uid: true })) {
        throw new BadGatewayException(`Не удалось удалить письмо с UID ${uid}`);
      }
    });
  }

  private async withMailbox<T>(
    accountId: string,
    mailbox: string,
    operation: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    return this.withClient(accountId, async (client) => {
      const lock = await client.getMailboxLock(mailbox);
      try {
        return await operation(client);
      } finally {
        lock.release();
      }
    });
  }

  private async fetchClassificationPreparations(
    client: ImapFlow,
    uids: number[],
  ): Promise<ClassificationPreparation[]> {
    if (uids.length === 0) return [];
    const preparations: ClassificationPreparation[] = [];
    for await (const message of client.fetch(
      uids,
      { uid: true, source: true },
      { uid: true },
    )) {
      if (!message.source) {
        preparations.push({ uid: message.uid, text: null, status: 'failed' });
        continue;
      }
      try {
        const text = await parseClassificationSource(message.source);
        preparations.push({
          uid: message.uid,
          text: text || null,
          status: text ? 'pending' : 'failed',
        });
      } catch {
        preparations.push({ uid: message.uid, text: null, status: 'failed' });
      }
    }
    return preparations;
  }

  private async withClient<T>(
    accountId: string,
    operation: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = new ImapFlow(this.options(accountId));

    try {
      await client.connect();
      return await operation(client);
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      const account = this.accounts.getConfig(accountId);
      const message = this.errorMessage(error);
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

      if (
        account?.provider === 'gmail'
        && this.isAuthenticationError(error, message)
      ) {
        throw new BadGatewayException(
          'Google отклонил вход. Включите двухэтапную аутентификацию и '
          + 'используйте 16-значный пароль приложения Google, а не пароль аккаунта.',
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
    provider: 'mailru' | 'yandex' | 'gmail';
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
      || /AUTHENTICATIONFAILED|AUTHORIZATIONFAILED/i.test(
        String(record?.serverResponseCode ?? ''),
      )
      || /auth|login|credential|password|парол|invalid credentials/i.test(
        `${message} ${String(record?.responseText ?? '')} ${String(record?.response ?? '')}`,
      );
  }

  private errorMessage(error: unknown): string {
    const record = error as Record<string, unknown> | null;
    const details = [
      record?.responseText,
      record?.response,
      record?.serverResponseCode,
      error instanceof Error ? error.message : error,
    ];
    return details
      .find((value) => typeof value === 'string' && value.trim() && value !== 'Command failed')
      ?.toString()
      ?? (error instanceof Error ? error.message : 'Неизвестная ошибка IMAP');
  }

  private errorDiagnostics(error: unknown): Record<string, unknown> {
    const record = error as Record<string, unknown> | null;
    return {
      name: error instanceof Error ? error.name : undefined,
      message: error instanceof Error ? error.message : String(error),
      code: record?.code,
      responseStatus: record?.responseStatus,
      responseText: record?.responseText,
      response: record?.response,
      serverResponseCode: record?.serverResponseCode,
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

export function prepareClassificationText(text: string, limit = 1_500): string {
  const cleaned = text
    .replace(/\u0000/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(cleaned).slice(0, limit).join('');
}

export async function parseClassificationSource(
  source: Buffer,
): Promise<string> {
  const parsed = await simpleParser(source);
  return prepareClassificationText(
    parsed.text
    || (typeof parsed.html === 'string' ? stripHtml(parsed.html) : ''),
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ');
}
