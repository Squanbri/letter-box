import { useQueries } from '@tanstack/react-query';
import type { AccountStatus } from '../../../shared/api/client';
import { api } from '../../../shared/api/client';
import { formatDate } from '../../../shared/lib/format';
import { useAuth } from '../../../state/auth/AuthProvider';
import { mailKeys } from '../../../state/mail/mail';

export function StatsGrid({
  accounts,
  onOpenUnread,
  onOpenImportant,
}: {
  accounts: AccountStatus[];
  onOpenUnread?: () => void;
  onOpenImportant?: () => void;
}) {
  const { session } = useAuth();
  const unreadCount = accounts.reduce((sum, account) => sum + account.unreadCount, 0);
  const connectedCount = accounts.filter((account) => account.status === 'connected').length;
  const latestSync = accounts
    .map((account) => account.lastSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const tagQueries = useQueries({
    queries: accounts.map((account) => ({
      queryKey: mailKeys.tags(account.id, 'INBOX'),
      queryFn: () => api.tagCounts(account.id, 'INBOX'),
      enabled: Boolean(session),
    })),
  });
  const importantCount = tagQueries.reduce((sum, query) => {
    const count = query.data?.find((item) => item.tag === 'important')?.count ?? 0;
    return sum + count;
  }, 0);

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
      <button
        type="button"
        className="stat-card stat-clickable"
        onClick={onOpenImportant}
        disabled={!onOpenImportant || importantCount === 0}
      >
        <span>Важные</span>
        <strong>{importantCount}</strong>
        <small>коды, учёба, работа · открыть</small>
      </button>
      <article className="stat-card"><span>Аккаунты</span><strong>{connectedCount}<em> / {accounts.length}</em></strong><small>сейчас подключены</small></article>
      <article className="stat-card"><span>Последнее обновление</span><strong className="stat-time">{latestSync ? formatDate(latestSync) : '—'}</strong><small>фоновая синхронизация</small></article>
    </div>
  );
}
