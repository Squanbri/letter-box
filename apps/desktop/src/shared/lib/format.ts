import type { AccountStatus, MailboxInfo, Message } from '../api/client';
import { MESSAGE_TAG_LABELS, type MessageTag } from '@letter-box/contracts';

export function tagLabel(tag: string) {
  return MESSAGE_TAG_LABELS[tag as MessageTag] ?? tag;
}

export function providerName(provider: AccountStatus['provider']) {
  if (provider === 'mailru') return 'Mail.ru';
  if (provider === 'yandex') return 'Яндекс';
  if (provider === 'gmail') return 'Gmail';
  return 'IMAP';
}

export function statusName(status: AccountStatus['status']) {
  return status === 'connected'
    ? 'Подключён'
    : status === 'syncing'
      ? 'Синхронизация…'
      : status === 'needs_reauth'
        ? 'Нужна повторная авторизация'
        : status === 'error'
          ? 'Требует внимания'
          : 'Не проверен';
}

export function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : 'Произошла неизвестная ошибка';
}

export function formatDate(value: string) {
  const date = new Date(value);
  const time = date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  if (date.toDateString() === new Date().toDateString()) return time;
  const day = date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
  return `${day} ${time}`;
}

/** Always `HH:mm` in 24-hour clock. */
export function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export function formatRelativeShort(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'сейчас';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} дн назад`;
  return formatDate(value);
}

export function dayBucketLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startToday.getTime() - startDate.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function formatCount(count: number) {
  return count > 999 ? '999+' : String(count);
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
