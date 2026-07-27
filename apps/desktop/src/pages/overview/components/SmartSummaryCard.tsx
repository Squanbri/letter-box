import { Badge } from '@mantine/core';
import { useQueries } from '@tanstack/react-query';
import { MESSAGE_TAGS } from '@letter-box/contracts';
import { api } from '../../../shared/api/client';
import { tagLabel } from '../../../shared/lib/format';
import { useAccountsQuery } from '../../../state/accounts/accounts';
import { useAuth } from '../../../state/auth/AuthProvider';
import { mailKeys } from '../../../state/mail/mail';

export function SmartSummaryCard({
  onOpenTag,
}: {
  onOpenTag?: (tag: string) => void;
}) {
  const { session } = useAuth();
  const { data: accounts = [] } = useAccountsQuery(Boolean(session));
  const queries = useQueries({
    queries: accounts.map((account) => ({
      queryKey: mailKeys.tags(account.id, 'INBOX'),
      queryFn: () => api.tagCounts(account.id, 'INBOX'),
      enabled: Boolean(session),
    })),
  });

  const totals = new Map<string, number>();
  for (const query of queries) {
    for (const item of query.data ?? []) {
      totals.set(item.tag, (totals.get(item.tag) ?? 0) + item.count);
    }
  }
  const ranked = MESSAGE_TAGS
    .map((tag) => ({ tag, count: totals.get(tag) ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count);
  const loading = queries.some((query) => query.isLoading);

  return (
    <section className="dashboard-card insight-card">
      <header>
        <div>
          <span className="eyebrow">Сводка</span>
          <h2>AI-теги</h2>
        </div>
        <Badge variant="light">{loading ? '…' : ranked.length ? 'Ollama' : 'Пусто'}</Badge>
      </header>
      {!ranked.length
        ? (
          <div className="insight-placeholder">
            <strong>{loading ? 'Собираем теги…' : 'Пока нет размеченных писем'}</strong>
            <p>Раз в ~30 сек worker берёт пачку непрочитанных писем и тегирует их через Ollama.</p>
          </div>
        )
        : (
          <ul className="tag-summary">
            {ranked.slice(0, 6).map(({ tag, count }) => (
              <li key={tag}>
                <button
                  type="button"
                  className="tag-summary-item"
                  onClick={() => onOpenTag?.(tag)}
                  disabled={!onOpenTag}
                >
                  <span>{tagLabel(tag)}</span>
                  <strong>{count}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
