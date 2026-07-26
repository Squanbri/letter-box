import type { AccountStatus } from '../api/client';

export async function requestNotificationSetting(enabled: boolean) {
  if (!enabled || typeof Notification === 'undefined') return false;
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  return permission === 'granted';
}

export function showNewMailNotification(account: AccountStatus, count: number) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const lastTwo = count % 100;
  const last = count % 10;
  const suffix = lastTwo >= 11 && lastTwo <= 14
    ? 'новых писем'
    : last === 1
      ? 'новое письмо'
      : last >= 2 && last <= 4
        ? 'новых письма'
        : 'новых писем';
  new Notification('Letter Box', { body: `${account.email}: ${count} ${suffix}` });
}
