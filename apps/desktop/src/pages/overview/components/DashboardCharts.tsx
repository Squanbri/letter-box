import type { ReactNode } from 'react';
import { AreaChart, BarChart, DonutChart } from '@mantine/charts';
import { Text } from '@mantine/core';
import { MESSAGE_TAGS } from '@letter-box/contracts';
import type { AccountStatus, DashboardStats } from '../../../shared/api/client';
import { tagLabel } from '../../../shared/lib/format';
import { useAuth } from '../../../state/auth/AuthProvider';
import { useDashboardStatsQuery } from '../../../state/mail/mail';

const SPAM_COLOR = '#a23c30';
const OTHER_COLOR = '#b8aa87';

function ChartCard({
  eyebrow,
  title,
  hint,
  children,
  empty,
  emptyMessage = 'Пока нет данных',
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  children: ReactNode;
  empty?: boolean;
  emptyMessage?: string;
}) {
  return (
    <section className="dashboard-card chart-card">
      <header>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {hint ? <small>{hint}</small> : null}
      </header>
      <div className="chart-body">
        {empty
          ? <div className="chart-empty"><Text size="sm" c="dimmed">{emptyMessage}</Text></div>
          : children}
      </div>
    </section>
  );
}

function UnreadByAccountChart({ accounts }: { accounts: AccountStatus[] }) {
  const data = accounts
    .filter((account) => account.unreadCount > 0)
    .map((account) => ({
      account: account.email.split('@')[0] || account.email,
      count: account.unreadCount,
    }));

  return (
    <ChartCard eyebrow="Непрочитанные" title="По аккаунтам" hint="INBOX" empty={!data.length}>
      <BarChart
        h={220}
        data={data}
        dataKey="account"
        series={[{ name: 'count', color: 'paperGold.6', label: 'Непрочитанные' }]}
        tickLine="y"
        gridAxis="y"
        withLegend={false}
      />
    </ChartCard>
  );
}

function SpamChart({
  unreadByTag,
  loading,
  errorMessage,
}: {
  unreadByTag: DashboardStats['unreadByTag'];
  loading?: boolean;
  errorMessage?: string;
}) {
  const spam = unreadByTag.find((item) => item.tag === 'spam')?.count ?? 0;
  const other = unreadByTag
    .filter((item) => item.tag !== 'spam')
    .reduce((sum, item) => sum + item.count, 0);
  const data = [
    { name: 'Спам', value: spam, color: SPAM_COLOR },
    { name: 'Остальные', value: other, color: OTHER_COLOR },
  ].filter((item) => item.value > 0);

  return (
    <ChartCard
      eyebrow="Спам"
      title="Среди непрочитанных"
      hint={spam ? `${spam} писем` : undefined}
      empty={Boolean(errorMessage) || (!loading && !data.length)}
      emptyMessage={errorMessage ?? 'Пока нет данных'}
    >
      <DonutChart
        data={data}
        chartLabel={String(spam)}
        size={180}
        thickness={28}
        withLabelsLine
        withLabels
        tooltipDataSource="segment"
      />
    </ChartCard>
  );
}

function MessagesByDayChart({
  rows,
  loading,
  errorMessage,
}: {
  rows: DashboardStats['messagesByDay'];
  loading?: boolean;
  errorMessage?: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const data = rows.map((row) => ({
    date: formatDayLabel(row.date),
    count: row.count,
  }));

  return (
    <ChartCard
      eyebrow="Активность"
      title="Письма по дням"
      hint="30 дней"
      empty={Boolean(errorMessage) || (!loading && total === 0)}
      emptyMessage={errorMessage ?? 'Пока нет данных'}
    >
      <AreaChart
        h={220}
        data={data}
        dataKey="date"
        series={[{ name: 'count', color: 'paperGold.6', label: 'Письма' }]}
        curveType="monotone"
        tickLine="y"
        gridAxis="xy"
        withLegend={false}
      />
    </ChartCard>
  );
}

function MessagesByTagChart({
  rows,
  loading,
  errorMessage,
}: {
  rows: DashboardStats['messagesByTag'];
  loading?: boolean;
  errorMessage?: string;
}) {
  const counts = new Map(rows.map((row) => [row.tag, row.count]));
  const data = MESSAGE_TAGS
    .map((tag) => ({ tag: tagLabel(tag), count: counts.get(tag) ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count);

  return (
    <ChartCard
      eyebrow="AI-теги"
      title="Письма по тегам"
      hint="все письма"
      empty={Boolean(errorMessage) || (!loading && !data.length)}
      emptyMessage={errorMessage ?? 'Пока нет данных'}
    >
      <BarChart
        h={220}
        data={data}
        dataKey="tag"
        series={[{ name: 'count', color: 'paperGold.7', label: 'Письма' }]}
        tickLine="y"
        gridAxis="y"
        withLegend={false}
      />
    </ChartCard>
  );
}

function formatDayLabel(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function DashboardCharts({ accounts }: { accounts: AccountStatus[] }) {
  const { session } = useAuth();
  const statsQuery = useDashboardStatsQuery(30, Boolean(session));
  const stats = statsQuery.data;
  const loading = statsQuery.isLoading;
  const errorMessage = statsQuery.isError
    ? (statsQuery.error instanceof Error
      ? statsQuery.error.message
      : 'Ошибка API /stats')
    : undefined;

  return (
    <div className="charts-grid">
      <UnreadByAccountChart accounts={accounts} />
      <SpamChart
        unreadByTag={stats?.unreadByTag ?? []}
        loading={loading}
        errorMessage={errorMessage}
      />
      <MessagesByDayChart
        rows={stats?.messagesByDay ?? []}
        loading={loading}
        errorMessage={errorMessage}
      />
      <MessagesByTagChart
        rows={stats?.messagesByTag ?? []}
        loading={loading}
        errorMessage={errorMessage}
      />
    </div>
  );
}
