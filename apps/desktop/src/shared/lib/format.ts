import type { AccountStatus, MailboxInfo, Message } from '../api/client';
import { MESSAGE_TAG_LABELS, type MessageTag } from '@letter-box/contracts';

export function tagLabel(tag: string) {
  return MESSAGE_TAG_LABELS[tag as MessageTag] ?? tag;
}

export function providerName(provider: AccountStatus['provider']) {
  return provider === 'mailru' ? 'Mail.ru' : provider === 'yandex' ? 'Яндекс' : 'Gmail';
}

export function statusName(status: AccountStatus['status']) {
  return status === 'connected'
    ? 'Подключён'
    : status === 'syncing'
      ? 'Синхронизация…'
      : status === 'error'
        ? 'Требует внимания'
        : 'Не проверен';
}

export function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Произошла неизвестная ошибка';
}

export function formatDate(value: string) {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

export function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function formatCount(count: number) {
  return count > 99 ? '99+' : String(count);
}

export function mailboxDisplayName(mailbox: MailboxInfo) {
  const names: Record<string, string> = {
    '\\Inbox': 'Входящие',
    '\\Sent': 'Отправленные',
    '\\Drafts': 'Черновики',
    '\\Junk': 'Спам',
    '\\Trash': 'Корзина',
    '\\Archive': 'Архив',
  };
  return mailbox.specialUse ? names[mailbox.specialUse] ?? mailbox.name : mailbox.name;
}

export function mailboxTitle(mailboxes: MailboxInfo[], path: string) {
  const mailbox = mailboxes.find((item) => item.path === path);
  return mailbox ? mailboxDisplayName(mailbox) : path;
}

export function mailboxIcon(specialUse: string | null) {
  const icons: Record<string, string> = {
    '\\Inbox': '↓',
    '\\Sent': '↑',
    '\\Drafts': '✎',
    '\\Junk': '!',
    '\\Trash': '⌫',
    '\\Archive': '□',
  };
  return specialUse ? icons[specialUse] ?? '•' : '•';
}

export function isSeen(message: Message) {
  return message.flags.includes('\\Seen');
}

export function withFlag(flags: string[], flag: string, enabled: boolean) {
  const next = new Set(flags);
  if (enabled) next.add(flag);
  else next.delete(flag);
  return [...next];
}
