import { Badge } from '@mantine/core';
import { useQueries } from '@tanstack/react-query';
import { MESSAGE_TAGS } from '@letter-box/contracts';
import { api } from '../../../shared/api/client';
import { tagLabel } from '../../../shared/lib/format';
import { useAccountsQuery } from '../../../state/accounts/accounts';
import { useAuth } from '../../../state/auth/AuthProvider';
import { mailKeys } from '../../../state/mail/mail';

const TAG_COLORS: Record<string, string> = {
  important: 'var(--red)',
  spam:      'var(--orange)',
  promo:     'var(--yellow)',
  work:      'var(--blue)',
  games:     'var(--purple)',
  news:      'var(--cyan)',
  it:        'var(--lime)',
  personal:  'var(--pink)',
  finance:   'var(--green)',
  other:     'var(--text-muted)',
};

const TAG_BG: Record<string, string> = {
  important: 'var(--red-surface)',
  spam:      'color-mix(in srgb, var(--orange) 15%, transparent)',
  promo:     'color-mix(in srgb, var(--yellow) 15%, transparent)',
  work:      'color-mix(in srgb, var(--blue) 12%, transparent)',
  games:     'color-mix(in srgb, var(--purple) 12%, transparent)',
  news:      'color-mix(in srgb, var(--cyan) 12%, transparent)',
  it:        'color-mix(in srgb, var(--lime) 12%, transparent)',
  personal:  'color-mix(in srgb, var(--pink) 12%, transparent)',
  finance:   'var(--green-surface)',
  other:     'var(--surface-secondary)',
};

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
    .sort((left, right) => {
      if (left.tag === 'important' && right.tag !== 'important') return -1;
      if (right.tag === 'important' && left.tag !== 'important') return 1;
      return right.count - left.count;
    });
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
          <div className="tag-pills-grid">
            {ranked.slice(0, 8).map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                className="tag-pill-btn"
                style={{
                  '--tag-color': TAG_COLORS[tag] ?? 'var(--text-muted)',
                  '--tag-bg': TAG_BG[tag] ?? 'var(--surface-secondary)',
                } as React.CSSProperties}
                onClick={() => onOpenTag?.(tag)}
                disabled={!onOpenTag}
              >
                <span className="tag-pill-label">{tagLabel(tag)}</span>
                <span className="tag-pill-count">{count}</span>
              </button>
            ))}
          </div>
        )}
    </section>
  );
}
