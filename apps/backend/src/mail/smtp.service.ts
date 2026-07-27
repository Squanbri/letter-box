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
import type { AccountConfig } from '../runtime';

interface SmtpEndpoint {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
}

const SMTP_ENDPOINTS: Record<AccountConfig['provider'], SmtpEndpoint[]> = {
  // Gmail: 465 часто режется DPI/провайдером; 587 + STARTTLS надёжнее.
  gmail: [
    { host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true },
    { host: 'smtp.gmail.com', port: 465, secure: true },
  ],
  yandex: [
    { host: 'smtp.yandex.ru', port: 465, secure: true },
    { host: 'smtp.yandex.ru', port: 587, secure: false, requireTLS: true },
  ],
  mailru: [
    { host: 'smtp.mail.ru', port: 465, secure: true },
    { host: 'smtp.mail.ru', port: 587, secure: false, requireTLS: true },
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
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

  async send(accountId: string, input: SendMessageInput): Promise<SmtpSendResult> {
    const account = this.accounts.getConfig(accountId);
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
    const endpoints = SMTP_ENDPOINTS[account.provider];
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
      auth: {
        user: this.smtpUsername(account),
        pass: account.password,
      },
    };
    return options;
  }

  private smtpUsername(account: AccountConfig): string {
    if (account.provider !== 'yandex') return account.email;
    const [localPart, domain] = account.email.split('@');
    return localPart && ['yandex.ru', 'ya.ru'].includes(domain?.toLowerCase())
      ? localPart
      : account.email;
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
    if (account.provider === 'yandex' && /auth|login|credential|password|парол/i.test(message)) {
      return 'Яндекс отклонил SMTP-вход. Проверьте, что SMTP включён и используется пароль приложения.';
    }
    if (account.provider === 'gmail' && /auth|login|credential|password|парол/i.test(message)) {
      return 'Google отклонил SMTP-вход. Используйте 16-значный пароль приложения Google.';
    }
    if (account.provider === 'mailru' && /auth|login|credential|password|парол/i.test(message)) {
      return 'Mail.ru отклонил SMTP-вход. Проверьте пароль приложения и доступ по SMTP.';
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
