import { useMemo, useState } from 'react';
import { Select, Switch, Text } from '@mantine/core';
import { MESSAGE_TAGS } from '@letter-box/contracts';
import type { AccountStatus } from '../../shared/api/client';
import { accountColor } from '../../shared/lib/accountColor';
import {
  errorMessage,
  formatRelativeShort,
  providerName,
  statusName,
  tagLabel,
} from '../../shared/lib/format';
import { HIDDEN_DASHBOARD_TAGS, tagBg, tagColor } from '../../shared/lib/tagColor';
import { usePreferences } from '../../state/preferences/PreferencesProvider';
import { useDashboardStatsQuery } from '../../state/mail/mail';
import { useSync } from '../../state/sync/SyncProvider';
import { useWorkspace } from '../../state/workspace/WorkspaceProvider';

function greetingDate(now = new Date()) {
  return now.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function capitalize(value: string) {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

export function DashboardPage({
  accounts,
  onAdd,
  onReconnect,
  onDelete,
}: {
  accounts: AccountStatus[];
  onAdd: () => void;
  onReconnect: (account: AccountStatus) => void;
  onDelete: (account: AccountStatus) => void;
}) {
  const workspace = useWorkspace();
  const { preferences, setAccountSync, setIntervalMinutes, setNotifications } = usePreferences();
  const { syncingIds } = useSync();
  const statsQuery = useDashboardStatsQuery(14);
  const [showHiddenTags, setShowHiddenTags] = useState(false);

  const unreadTotal = accounts.reduce((sum, account) => sum + account.unreadCount, 0);
  const importantUnread = statsQuery.data?.unreadByTag.find((row) => row.tag === 'important')?.count ?? 0;
  const awaiting = statsQuery.data?.awaitingReply ?? [];
  const matrix = statsQuery.data?.tagAccountMatrix ?? [];
  const connected = accounts.filter((account) => account.status === 'connected').length;
  const lastSync = accounts
    .map((account) => account.lastSyncAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const visibleTags = useMemo(() => {
    const hidden = new Set<string>(HIDDEN_DASHBOARD_TAGS);
    return MESSAGE_TAGS.filter((tag) => showHiddenTags || !hidden.has(tag));
  }, [showHiddenTags]);

  const hiddenTotals = useMemo(() => {
    const map = new Map((statsQuery.data?.messagesByTag ?? []).map((row) => [row.tag, row.count]));
    return HIDDEN_DASHBOARD_TAGS.map((tag) => ({
      tag,
      count: map.get(tag) ?? 0,
    }));
  }, [statsQuery.data?.messagesByTag]);

  const flowSeries = useMemo(() => {
    const byAccount = statsQuery.data?.messagesByDayByAccount ?? [];
    const totals = statsQuery.data?.messagesByDay ?? [];
    const dates = byAccount[0]?.days.map((day) => day.date)
      ?? totals.map((day) => day.date);
    if (!dates.length) {
      return {
        data: [] as Array<{
          date: string;
          total: number;
          segments: Array<{ accountId: string; email: string; count: number; color: string }>;
        }>,
        max: 1,
      };
    }
    const data = dates.map((date) => {
      const segments = byAccount.map((account) => ({
        accountId: account.accountId,
        email: account.email,
        count: account.days.find((day) => day.date === date)?.count ?? 0,
        color: accountColor(account.accountId).accent,
      }));
      const total = segments.length
        ? segments.reduce((sum, segment) => sum + segment.count, 0)
        : totals.find((day) => day.date === date)?.count ?? 0;
      return {
        date,
        total,
        segments: segments.filter((segment) => segment.count > 0),
      };
    });
    return { data, max: Math.max(1, ...data.map((row) => row.total)) };
  }, [statsQuery.data?.messagesByDay, statsQuery.data?.messagesByDayByAccount]);

  const totalFlow = statsQuery.data?.messagesByDay.reduce((sum, day) => sum + day.count, 0) ?? 0;
  const classified = statsQuery.data?.classifiedCount ?? 0;
  const totalCount = statsQuery.data?.totalCount ?? 0;

  return (
    <section className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1>{capitalize(greetingDate())}</h1>
          <p className="dashboard-subtitle">
            {accounts.length} аккаунт{accounts.length === 1 ? '' : accounts.length < 5 ? 'а' : 'ов'}
            {lastSync ? ` · синхронизировано ${formatRelativeShort(lastSync)}` : ''}
            {totalCount > 0 ? ` · Ollama разметила ${classified} из ${totalCount}` : ''}
          </p>
        </div>
        <div className="dashboard-stat-pills">
          <button type="button" className="stat-pill" onClick={() => workspace.openUnread()}>
            <span>Непрочитанных</span>
            <strong>{unreadTotal}</strong>
          </button>
          <button
            type="button"
            className="stat-pill"
            onClick={() => workspace.openTag('important')}
          >
            <span>Важные</span>
            <strong>{importantUnread}</strong>
          </button>
          <button
            type="button"
            className="stat-pill"
            onClick={() => {
              const first = awaiting[0];
              if (!first) return;
              workspace.openAll();
              workspace.setAccountScope(first.accountId);
              workspace.selectMessage({
                accountId: first.accountId,
                mailbox: first.mailbox,
                uid: first.uid,
              });
            }}
          >
            <span>Ждут ответа</span>
            <strong>{awaiting.length}</strong>
          </button>
        </div>
      </header>

      <div className="dashboard-body">
        <section className="dashboard-card matrix-card">
          <header>
            <div>
              <h2>Теги по аккаунтам</h2>
              <p>строка — все аккаунты · ячейка — один</p>
            </div>
          </header>
          <div className="matrix-table-wrap">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>Тег</th>
                  {accounts.map((account) => (
                    <th key={account.id}>
                      <span
                        className="account-dot"
                        style={{ background: accountColor(account.id).accent }}
                      />
                      {providerName(account.provider).toLowerCase()}
                    </th>
                  ))}
                  <th>Всего</th>
                </tr>
              </thead>
              <tbody>
                {visibleTags.map((tag) => {
                  const cells = accounts.map((account) => {
                    const cell = matrix.find(
                      (row) => row.tag === tag && row.accountId === account.id,
                    );
                    return {
                      accountId: account.id,
                      count: cell?.count ?? 0,
                      unreadCount: cell?.unreadCount ?? 0,
                    };
                  });
                  const total = cells.reduce((sum, cell) => sum + cell.count, 0);
                  const unread = cells.reduce((sum, cell) => sum + cell.unreadCount, 0);
                  return (
                    <tr key={tag}>
                      <td>
                        <button
                          type="button"
                          className="matrix-tag"
                          onClick={() => workspace.openTag(tag)}
                        >
                          <span className="tag-dot" style={{ background: tagColor(tag) }} />
                          <span>
                            <strong>{tagLabel(tag)}</strong>
                            {unread > 0 && <small>{unread} непроч.</small>}
                          </span>
                        </button>
                      </td>
                      {cells.map((cell) => (
                        <td key={cell.accountId}>
                          <button
                            type="button"
                            className={[
                              'matrix-cell',
                              cell.unreadCount > 0 ? 'has-unread' : '',
                            ].filter(Boolean).join(' ')}
                            style={cell.unreadCount > 0
                              ? { background: tagBg(tag), color: tagColor(tag) }
                              : undefined}
                            disabled={cell.count === 0}
                            onClick={() => workspace.openTag(tag, cell.accountId)}
                          >
                            {cell.count || '—'}
                          </button>
                        </td>
                      ))}
                      <td>
                        <button
                          type="button"
                          className="matrix-cell total"
                          disabled={total === 0}
                          onClick={() => workspace.openTag(tag, null)}
                        >
                          {total || '—'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!showHiddenTags && hiddenTotals.some((row) => row.count > 0) && (
            <footer className="matrix-footer">
              <span>
                Спам и «Другое» скрыты · {hiddenTotals.map((row) => row.count).join(' и ')} писем
              </span>
              <button type="button" onClick={() => setShowHiddenTags(true)}>Показать все</button>
            </footer>
          )}
        </section>

        <aside className="dashboard-side">
          <section className="dashboard-card flow-card">
            <header>
              <div>
                <h2>Поток за 14 дней</h2>
                <p>{totalFlow} писем</p>
              </div>
            </header>
            {flowSeries.data.length > 0 ? (
              <div className="flow-chart" role="img" aria-label="Поток писем за 14 дней">
                {flowSeries.data.map((row) => (
                  <div
                    key={row.date}
                    className="flow-bar"
                    title={`${row.date}: ${row.total}`}
                  >
                    <div className="flow-bar-stack" style={{ height: `${(row.total / flowSeries.max) * 100}%` }}>
                      {row.segments.length > 0
                        ? row.segments.map((segment) => (
                          <span
                            key={segment.accountId}
                            style={{
                              flex: segment.count,
                              background: segment.color,
                            }}
                            title={`${segment.email}: ${segment.count}`}
                          />
                        ))
                        : row.total > 0 && (
                          <span style={{ flex: 1, background: 'var(--ink-muted)' }} />
                        )}
                    </div>
                    <em>{row.date.slice(8)}</em>
                  </div>
                ))}
              </div>
            ) : (
              <Text size="sm" c="dimmed">Пока нет данных</Text>
            )}
            {statsQuery.error && (
              <Text size="xs" c="red">{errorMessage(statsQuery.error)}</Text>
            )}
          </section>

          <section className="dashboard-card accounts-card">
            <header>
              <div>
                <h2>Аккаунты</h2>
                <p>{connected}/{accounts.length} подключено</p>
              </div>
              <button type="button" className="text-btn" onClick={onAdd}>+ Добавить почту</button>
            </header>
            {accounts.length === 0 ? (
              <div className="empty-accounts">
                <p>Подключите Gmail, Яндекс, Mail.ru или другой IMAP</p>
                <button type="button" className="compose-send" onClick={onAdd}>+ Добавить почту</button>
              </div>
            ) : (
              <ul className="account-rows">
                {accounts.map((account) => {
                  const color = accountColor(account.id);
                  const disabled = preferences.disabledAccountIds.includes(account.id);
                  return (
                    <li key={account.id}>
                      <button
                        type="button"
                        className="account-row-main"
                        onClick={() => {
                          workspace.openAll();
                          workspace.setAccountScope(account.id);
                        }}
                      >
                        <span className="account-dot" style={{ background: color.accent }} />
                        <span>
                          <strong>{account.email}</strong>
                          <small>
                            {account.status === 'needs_reauth'
                              ? 'нужна повторная авторизация'
                              : account.status === 'error' && account.lastError
                              ? 'нужен повторный вход'
                              : syncingIds.has(account.id)
                                ? 'синхр. сейчас'
                                : statusName(account.status).toLowerCase()}
                            {account.lastSyncAt ? ` · ${formatRelativeShort(account.lastSyncAt)}` : ''}
                          </small>
                        </span>
                        {account.unreadCount > 0 && (
                          <em>{account.unreadCount}</em>
                        )}
                      </button>
                      <div className="account-row-actions">
                        <Switch
                          size="xs"
                          checked={!disabled}
                          onChange={(event) => setAccountSync(account.id, event.currentTarget.checked)}
                          title="Авто-синхронизация"
                        />
                        {(account.status === 'error' || account.status === 'disconnected' || account.status === 'needs_reauth') && (
                          <button type="button" onClick={() => onReconnect(account)}>↻</button>
                        )}
                        <button type="button" onClick={() => onDelete(account)}>×</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="dashboard-card awaiting-card">
            <header>
              <div>
                <h2>Ждут ответа</h2>
                <p>вы читали, но не ответили</p>
              </div>
            </header>
            {awaiting.length === 0 ? (
              <Text size="sm" c="dimmed">Пусто — все ответы закрыты</Text>
            ) : (
              <ul className="awaiting-list">
                {awaiting.map((item) => (
                  <li key={`${item.accountId}:${item.uid}`}>
                    <button
                      type="button"
                      className="awaiting-row"
                      onClick={() => {
                        workspace.openAll();
                        workspace.setAccountScope(item.accountId);
                        workspace.selectMessage({
                          accountId: item.accountId,
                          mailbox: item.mailbox,
                          uid: item.uid,
                        });
                      }}
                    >
                      <span className="awaiting-text">
                        <strong>{item.fromName || item.fromAddress || 'Без имени'}</strong>
                        <span>{item.subject || 'Без темы'}</span>
                      </span>
                      <em>{item.daysWaiting || 1} дн.</em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dashboard-card sync-card">
            <header>
              <div>
                <h2>Синхронизация</h2>
                <p>фон и уведомления</p>
              </div>
            </header>
            <div className="sync-settings">
              <Select
                size="xs"
                label="Интервал"
                value={String(preferences.intervalMinutes)}
                data={[
                  { value: '5', label: '5 минут' },
                  { value: '15', label: '15 минут' },
                  { value: '30', label: '30 минут' },
                ]}
                onChange={(value) => value && setIntervalMinutes(Number(value))}
              />
              <Switch
                label="Уведомления о новых письмах"
                checked={preferences.notifications}
                onChange={(event) => void setNotifications(event.currentTarget.checked)}
              />
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
