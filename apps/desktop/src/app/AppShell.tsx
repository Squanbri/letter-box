import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import { Badge, Button, Center, Loader, Text } from '@mantine/core';
import type { AccountStatus } from '../shared/api/client';
import { errorMessage, formatCount, tagLabel } from '../shared/lib/format';
import { AccountDialog } from '../components/account-dialog/AccountDialog';
import { AuthPage } from '../pages/auth/AuthPage';
import { UnifiedInboxPage } from '../pages/inbox/UnifiedInboxPage';
import { MailboxPage } from '../pages/mailbox/MailboxPage';
import { OverviewPage } from '../pages/overview/OverviewPage';
import { useAccountsQuery, useDeleteAccountMutation } from '../state/accounts/accounts';
import { useAuth } from '../state/auth/AuthProvider';
import {
  isUnifiedTab,
  parseUnifiedTab,
  useWorkspace,
} from '../state/workspace/WorkspaceProvider';

const EMPTY_ACCOUNTS: AccountStatus[] = [];

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('letter-box.theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('letter-box.theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark] as const;
}

export function AppShell() {
  const { session, logout } = useAuth();
  const accountsQuery = useAccountsQuery(Boolean(session));
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const workspace = useWorkspace();
  const removeAccount = useDeleteAccountMutation();
  const [editing, setEditing] = useState<AccountStatus | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dark, setDark] = useDarkMode();

  useEffect(() => {
    if (accountsQuery.data) {
      workspace.reconcileAccounts(accountsQuery.data.map((account) => account.id));
    }
  }, [accountsQuery.data]);

  if (session === undefined) {
    return <Center h="100vh"><Loader /></Center>;
  }
  if (!session) return <AuthPage />;
  if (accountsQuery.isLoading) {
    return <Center h="100vh"><Loader /></Center>;
  }
  if (accountsQuery.error) {
    return (
      <Center h="100vh">
        <div><Text c="red">{errorMessage(accountsQuery.error)}</Text><Button mt="md" onClick={() => void accountsQuery.refetch()}>Повторить</Button></div>
      </Center>
    );
  }

  const onTabDragStart = (event: DragEvent<HTMLDivElement>, id: string) => {
    setDraggingId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const onTabDragOver = (event: DragEvent<HTMLDivElement>, id: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverId !== id) setDragOverId(id);
  };

  const onTabDrop = (event: DragEvent<HTMLDivElement>, toId: string) => {
    event.preventDefault();
    const fromId = event.dataTransfer.getData('text/plain') || draggingId;
    if (fromId) workspace.moveTab(fromId, toId);
    setDraggingId(null);
    setDragOverId(null);
  };

  const onTabDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  return (
    <main className="app-shell">
      <nav className="tabbar">
        <button
          className={workspace.active === 'overview' ? 'tab active tab-pinned' : 'tab tab-pinned'}
          onClick={() => workspace.setActive('overview')}
        >
          Обзор
        </button>
        {workspace.tabs.map((id) => {
          const unified = parseUnifiedTab(id);
          const className = [
            'tab',
            'tab-movable',
            workspace.active === id ? 'active' : '',
            draggingId === id ? 'dragging' : '',
            dragOverId === id && draggingId !== id ? 'drag-over' : '',
          ].filter(Boolean).join(' ');

          if (unified) {
            const label = unified.kind === 'unread'
              ? 'Непрочитанные'
              : tagLabel(unified.tag);
            return (
              <div
                className={className}
                key={id}
                draggable
                onDragStart={(event) => onTabDragStart(event, id)}
                onDragOver={(event) => onTabDragOver(event, id)}
                onDrop={(event) => onTabDrop(event, id)}
                onDragEnd={onTabDragEnd}
              >
                <button onClick={() => workspace.setActive(id)}>{label}</button>
                <button
                  className="tab-close"
                  title="Закрыть вкладку"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => workspace.closeAccount(id)}
                >
                  ×
                </button>
              </div>
            );
          }
          const account = accounts.find((item) => item.id === id);
          if (!account) return null;
          return (
            <div
              className={className}
              key={id}
              draggable
              onDragStart={(event) => onTabDragStart(event, id)}
              onDragOver={(event) => onTabDragOver(event, id)}
              onDrop={(event) => onTabDrop(event, id)}
              onDragEnd={onTabDragEnd}
            >
              <button onClick={() => workspace.setActive(id)}>{account.email}</button>
              {account.unreadCount > 0 && <Badge size="xs">{formatCount(account.unreadCount)}</Badge>}
              <button
                className="tab-close"
                title="Закрыть вкладку"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => workspace.closeAccount(id)}
              >
                ×
              </button>
            </div>
          );
        })}
        <div className="tabbar-end">
          <button className="tab-theme-toggle" title={dark ? 'Светлая тема' : 'Тёмная тема'} onClick={() => setDark((d) => !d)}>{dark ? '☀︎' : '☾'}</button>
          <button className="tab auth-logout" title={session.user.email} onClick={() => void logout()}>Выйти</button>
        </div>
      </nav>
      {error && <div className="error-banner">{error}</div>}
      <div className={workspace.active === 'overview' ? 'tab-panel active' : 'tab-panel'}>
        <OverviewPage
          accounts={accounts}
          onAdd={() => setEditing('new')}
          onReconnect={setEditing}
          onDelete={(account) => {
            if (!window.confirm(`Удалить аккаунт ${account.email} и все его локальные данные?`)) return;
            removeAccount.mutate(account.id, {
              onSuccess: () => workspace.closeAccount(account.id),
              onError: (reason) => setError(errorMessage(reason)),
            });
          }}
        />
      </div>
      {workspace.tabs.map((id) => {
        const unified = parseUnifiedTab(id);
        if (unified) {
          return (
            <div className={workspace.active === id ? 'tab-panel active' : 'tab-panel'} key={id}>
              <UnifiedInboxPage view={unified} accounts={accounts} />
            </div>
          );
        }
        if (isUnifiedTab(id)) return null;
        const account = accounts.find((item) => item.id === id);
        return account ? (
          <div className={workspace.active === id ? 'tab-panel active' : 'tab-panel'} key={id}>
            <MailboxPage account={account} />
          </div>
        ) : null;
      })}
      <AccountDialog
        current={editing === 'new' ? null : editing}
        opened={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(account) => {
          setEditing(null);
          workspace.openAccount(account.id);
        }}
      />
    </main>
  );
}
