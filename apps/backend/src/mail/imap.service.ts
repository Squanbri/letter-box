import {
  BadGatewayException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  MailboxChanges,
  MailboxRecord,
  ClassificationPreparation,
  MessageFlags,
  MessageMetadata,
  computeThreadId,
  normalizeMessageId,
  parseMessageIds,
} from './mail.types';
import { AccountService } from '../account/account.service';
import { TokenService } from '../account/token.service';
import { ImapClientFactory } from './imap-client.factory';
import type { AccountConfig } from '../runtime';

const METADATA_FETCH = {
  uid: true,
  envelope: true,
  flags: true,
  size: true,
  headers: ['references'] as string[],
};

@Injectable()
export class ImapService {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(ImapClientFactory) private readonly clients: ImapClientFactory,
  ) {}

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
          METADATA_FETCH,
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
      const pageUids = selectBackfillUids(serverUids, beforeUid, limit);
      const messages: MessageMetadata[] = [];
      if (pageUids.length > 0) {
        for await (const message of client.fetch(
          pageUids,
          METADATA_FETCH,
          { uid: true },
        )) {
          messages.push(this.toMetadata(message));
        }
      }
      return messages;
    });
  }

  async fetchBody(accountId: string, mailbox: string, uid: number): Promise<{
    text: string | null;
    html: string | null;
    messageId: string | null;
    inReplyTo: string | null;
    references: string[];
    threadId: string | null;
  }> {
    return this.withMailbox(accountId, mailbox, async (client) => {
      const message = await client.fetchOne(uid, { source: true }, { uid: true });

      if (!message || !message.source) {
        throw new BadGatewayException(`Письмо с UID ${uid} не найдено на IMAP-сервере`);
      }

      const parsed = await simpleParser(message.source);
      const messageId = normalizeMessageId(parsed.messageId);
      const inReplyTo = normalizeMessageId(parsed.inReplyTo);
      const references = parseMessageIds(parsed.references);
      return {
        text: parsed.text || null,
        html: typeof parsed.html === 'string' ? parsed.html : null,
        messageId,
        inReplyTo,
        references,
        threadId: computeThreadId(messageId, inReplyTo, references),
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

  async appendMessage(
    accountId: string,
    mailbox: string,
    source: Buffer | string,
    flags: string[] = ['\\Seen'],
  ): Promise<void> {
    await this.withClient(accountId, async (client) => {
      const result = await client.append(mailbox, source, flags);
      if (!result) {
        throw new BadGatewayException(`Не удалось сохранить письмо в папку ${mailbox}`);
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
    const account = await this.tokens.ensureFresh(accountId);
    try {
      return await this.connectAndRun(account, operation);
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (
        account.authType === 'oauth'
        && this.isAuthenticationError(error, this.errorMessage(error))
      ) {
        try {
          const refreshed = await this.tokens.refresh(this.accounts.getConfig(accountId));
          return await this.connectAndRun(refreshed, operation);
        } catch (retryError) {
          if (retryError instanceof BadGatewayException) throw retryError;
          await this.accounts.setStatus(
            accountId,
            'needs_reauth',
            'Требуется повторная авторизация почтового ящика',
          );
          throw new BadGatewayException(
            'Сессия почтового ящика истекла. Подключите аккаунт заново.',
          );
        }
      }
      throw this.wrapImapError(accountId, error);
    }
  }

  private async connectAndRun<T>(
    account: AccountConfig,
    operation: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = new ImapFlow(this.clients.options(account));
    try {
      await client.connect();
      return await operation(client);
    } finally {
      if (client.usable) {
        await client.logout().catch(() => undefined);
      }
    }
  }

  private wrapImapError(accountId: string, error: unknown): never {
    const account = this.accounts.getConfig(accountId);
    const message = this.errorMessage(error);
    console.warn('[backend:imap] Ошибка подключения', {
      provider: account?.provider,
      host: account?.host,
      user: account ? this.maskEmail(account.email) : undefined,
      ...this.errorDiagnostics(error),
    });

    if (account.authType === 'oauth' && this.isAuthenticationError(error, message)) {
      throw new BadGatewayException(
        'Почтовый сервис отклонил OAuth-вход. Подключите аккаунт заново.',
      );
    }

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
    const messageId = normalizeMessageId(message.envelope?.messageId);
    const inReplyTo = normalizeMessageId(message.envelope?.inReplyTo);
    const references = parseMessageIds(extractReferencesHeader(message.headers));
    return {
      uid: message.uid,
      subject: message.envelope?.subject ?? null,
      senderName: sender?.name ?? null,
      senderAddress: sender?.address ?? null,
      date: (message.envelope?.date ?? new Date(0)).toISOString(),
      flags: Array.from(message.flags ?? []),
      size: message.size ?? 0,
      messageId,
      inReplyTo,
      references,
      threadId: computeThreadId(messageId, inReplyTo, references),
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

/**
 * History walk newest→oldest: among UIDs strictly below `beforeUid`
 * (or the whole folder when unset), take the highest `limit` UIDs.
 */
export function selectBackfillUids(
  serverUids: number[],
  beforeUid: number | undefined,
  limit: number,
): number[] {
  const candidates = beforeUid === undefined
    ? serverUids
    : serverUids.filter((uid) => uid < beforeUid);
  if (limit <= 0 || candidates.length === 0) return [];
  return candidates.slice(-limit);
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

function extractReferencesHeader(headers: Buffer | undefined): string | null {
  if (!headers?.length) return null;
  const text = headers.toString('utf8');
  const match = text.match(/^references:\s*(.*(?:\r?\n[ \t].*)*)/im);
  return match?.[1]?.replace(/\r?\n[ \t]+/g, ' ').trim() ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ');
}
