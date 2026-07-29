import { Button, Group, Text, Title } from '@mantine/core';
import type { AccountStatus } from '../../shared/api/client';
import { usePreferences } from '../../state/preferences/PreferencesProvider';
import { useSync } from '../../state/sync/SyncProvider';
import { useWorkspace } from '../../state/workspace/WorkspaceProvider';
import { AccountList } from './components/AccountList';
import { DashboardCharts } from './components/DashboardCharts';
import { SmartSummaryCard } from './components/SmartSummaryCard';
import { StatsGrid } from './components/StatsGrid';
import { SyncSettingsCard } from './components/SyncSettingsCard';

export function OverviewPage({
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
  const { openAccount, openUnified } = useWorkspace();
  const { preferences, setAccountSync } = usePreferences();
  const { syncingIds, syncAll } = useSync();

  return (
    <section className="overview">
      <header className="page-header">
        <div><Text className="eyebrow">Рабочее пространство</Text><Title order={1}>Добрый день</Title></div>
        <Group className="page-actions" gap="xs">
          <Button variant="outline" loading={syncingIds.size > 0} disabled={!accounts.length} onClick={() => void syncAll()}>Обновить все</Button>
          <Button onClick={onAdd}>Добавить аккаунт</Button>
        </Group>
      </header>
      <div className="dashboard">
        <AccountList
          accounts={accounts}
          disabledAccountIds={preferences.disabledAccountIds}
          onOpen={openAccount}
          onAdd={onAdd}
          onReconnect={onReconnect}
          onDelete={onDelete}
          onAccountSync={setAccountSync}
        />
        <StatsGrid
          accounts={accounts}
          onOpenUnread={() => openUnified({ kind: 'unread' })}
          onOpenImportant={() => openUnified({ kind: 'tag', tag: 'important' })}
        />
        <DashboardCharts accounts={accounts} />
        <div className="dashboard-grid">
          <SmartSummaryCard onOpenTag={(tag) => openUnified({ kind: 'tag', tag })} />
          <aside className="dashboard-side">
            <SyncSettingsCard />
          </aside>
        </div>
      </div>
    </section>
  );
}
