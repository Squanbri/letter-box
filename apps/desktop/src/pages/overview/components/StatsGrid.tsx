import type { AccountStatus } from '../../../shared/api/client';
import { formatDate } from '../../../shared/lib/format';

export function StatsGrid({
  accounts,
  onOpenUnread,
}: {
  accounts: AccountStatus[];
  onOpenUnread?: () => void;
}) {
  const unreadCount = accounts.reduce((sum, account) => sum + account.unreadCount, 0);
  const connectedCount = accounts.filter((account) => account.status === 'connected').length;
  const attentionCount = accounts.filter((account) => account.status === 'error').length;
  const latestSync = accounts
    .map((account) => account.lastSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <div className="stat-grid">
      <button
        type="button"
        className="stat-card stat-primary stat-clickable"
        onClick={onOpenUnread}
        disabled={!onOpenUnread || unreadCount === 0}
      >
        <span>Непрочитанные</span>
        <strong>{unreadCount}</strong>
        <small>во всех входящих · открыть</small>
      </button>
      <article className="stat-card"><span>Аккаунты</span><strong>{connectedCount}<em> / {accounts.length}</em></strong><small>сейчас подключены</small></article>
      <article className="stat-card"><span>Требуют внимания</span><strong>{attentionCount}</strong><small>{attentionCount ? 'проверьте подключение' : 'всё работает штатно'}</small></article>
      <article className="stat-card"><span>Последнее обновление</span><strong className="stat-time">{latestSync ? formatDate(latestSync) : '—'}</strong><small>фоновая синхронизация</small></article>
    </div>
  );
}
