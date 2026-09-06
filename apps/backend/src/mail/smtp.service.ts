import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { SendMessageInput } from '@letter-box/contracts';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { AccountService } from '../account/account.service';
import { TokenService } from '../account/token.service';
import { smtpAuth } from './imap-client.factory';
import type { AccountConfig } from '../runtime';

interface SmtpEndpoint {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
}

const SMTP_FALLBACKS: Partial<Record<AccountConfig['provider'], SmtpEndpoint[]>> = {
  gmail: [
    { host: 'smtp.gmail.com', port: 465, secure: true },
  ],
  yandex: [
    { host: 'smtp.yandex.ru', port: 465, secure: true },
  ],
  mailru: [
    { host: 'smtp.mail.ru', port: 465, secure: true },
  ],
};

export interface SmtpSendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  raw: Buffer;
}

@Injectable()
export class SmtpService {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async send(accountId: string, input: SendMessageInput): Promise<SmtpSendResult> {
    const account = await this.tokens.ensureFresh(accountId);
    const recipients = uniqueAddresses([
      ...input.to,
      ...(input.cc ?? []),
      ...(input.bcc ?? []),
    ]);
    if (recipients.length === 0) {
      throw new BadRequestException('Укажите хотя бы одного получателя');
    }

    const mail = {
      from: account.email,
      to: input.to.join(', '),
      cc: input.cc?.length ? input.cc.join(', ') : undefined,
      bcc: input.bcc?.length ? input.bcc.join(', ') : undefined,
      subject: input.subject,
      text: input.text,
      inReplyTo: input.inReplyTo,
      references: input.references,
    };

    try {
      const raw = await new MailComposer(mail).compile().build();
      const info = await this.sendWithFallback(account, recipients, raw);
      return {
        messageId: info.messageId || '',
        accepted: flattenAddresses(info.accepted),
        rejected: flattenAddresses(info.rejected),
        raw,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException(this.errorMessage(account, error));
    }
  }

  private async sendWithFallback(
    account: AccountConfig,
    recipients: string[],
    raw: Buffer,
  ): Promise<SMTPTransport.SentMessageInfo> {
    const endpoints = this.endpoints(account);
    let lastError: unknown;
    for (const endpoint of endpoints) {
      try {
        const transporter = nodemailer.createTransport(this.transportOptions(account, endpoint));
        return await transporter.sendMail({
          envelope: {
            from: account.email,
            to: recipients,
          },
          raw,
        });
      } catch (error) {
        lastError = error;
        if (!isRetryableSmtpError(error) || endpoint === endpoints[endpoints.length - 1]) {
          throw error;
        }
        console.warn('[backend:smtp] endpoint failed, trying fallback', {
          provider: account.provider,
          host: endpoint.host,
          port: endpoint.port,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    throw lastError ?? new Error('SMTP недоступен');
  }

  private transportOptions(
    account: AccountConfig,
    endpoint: SmtpEndpoint,
  ): SMTPTransport.Options {
    const options: SMTPTransport.Options & { family: 4 } = {
      host: endpoint.host,
      port: endpoint.port,
      secure: endpoint.secure,
      requireTLS: endpoint.requireTLS,
      // Docker/macOS часто ломают IPv6 до smtp.gmail.com.
      family: 4,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
      tls: {
        servername: endpoint.host,
        minVersion: 'TLSv1.2',
      },
      auth: smtpAuth(account),
    };
    return options;
  }

  private endpoints(account: AccountConfig): SmtpEndpoint[] {
    const primary: SmtpEndpoint = {
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      requireTLS: !account.smtpSecure,
    };
    const extras = (SMTP_FALLBACKS[account.provider] ?? [])
      .filter((item) => item.host !== primary.host || item.port !== primary.port);
    return [primary, ...extras];
  }

  private errorMessage(account: AccountConfig, error: unknown): string {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка SMTP';
    if (isRetryableSmtpError(error)) {
      if (account.provider === 'gmail') {
        return 'Сеть блокирует SMTP Gmail (порты 465/587). '
          + 'Отправка с этого аккаунта сейчас недоступна — попробуйте VPN '
          + 'или отправьте письмо с аккаунта Mail.ru / Яндекс.';
      }
      return `Не удалось установить защищённое SMTP-соединение (${account.provider}). `
        + 'Проверьте сеть, VPN и доступ исходящих портов 465/587.';
    }
    if (/auth|login|credential|password|парол|invalid_grant/i.test(message)) {
      if (account.authType === 'oauth') {
        return 'Почтовый сервис отклонил SMTP по OAuth. Подключите аккаунт заново.';
      }
      if (account.provider === 'yandex') {
        return 'Яндекс отклонил SMTP-вход. Проверьте, что SMTP включён и используется пароль приложения.';
      }
      if (account.provider === 'gmail') {
        return 'Google отклонил SMTP-вход. Используйте 16-значный пароль приложения Google.';
      }
      if (account.provider === 'mailru') {
        return 'Mail.ru отклонил SMTP-вход. Проверьте пароль приложения и доступ по SMTP.';
      }
    }
    return `Ошибка SMTP: ${message}`;
  }
}

function isRetryableSmtpError(error: unknown): boolean {
  const record = error as { code?: string; message?: string } | null;
  const code = String(record?.code ?? '');
  const message = String(record?.message ?? (error instanceof Error ? error.message : error));
  return code === 'ETIMEDOUT'
    || code === 'ESOCKET'
    || code === 'ECONNECTION'
    || code === 'ECONNRESET'
    || code === 'ENETUNREACH'
    || /disconnected before secure TLS|Greeting never received|Connection timeout|socket disconnected/i
      .test(message);
}

function uniqueAddresses(addresses: string[]): string[] {
  return [...new Set(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean))];
}

function flattenAddresses(
  value: string | Array<string | { address?: string | null; name?: string | null }> | undefined,
): string[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (typeof item === 'string') return item;
    return item.address ?? '';
  }).filter(Boolean);
}
