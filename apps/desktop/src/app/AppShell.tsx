import { useEffect, useMemo, useState } from 'react';
import { Center, Loader, Text, Button } from '@mantine/core';
import type { AccountStatus } from '../shared/api/client';
import { accountColor } from '../shared/lib/accountColor';
import { errorMessage, formatCount, tagLabel } from '../shared/lib/format';
import { PRIMARY_NAV_TAGS, tagBg, tagColor, tagGlyph } from '../shared/lib/tagColor';
import { AccountDialog } from '../components/account-dialog/AccountDialog';
import { WindowTrafficLights } from '../components/window-controls/WindowTrafficLights';
import { AuthPage } from '../pages/auth/AuthPage';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { MailSectionPage } from '../pages/mail/MailSectionPage';
import { TagPalette } from '../components/tag-palette/TagPalette';
import {
  buildComposeDraft,
  ComposeDialog,
  type ComposeState,
} from '../pages/mailbox/components/ComposeDialog';
import { useAccountsQuery, useDeleteAccountMutation } from '../state/accounts/accounts';
import { useAuth } from '../state/auth/AuthProvider';
import { useDashboardStatsQuery } from '../state/mail/mail';
import { useSync } from '../state/sync/SyncProvider';
import { useWorkspace } from '../state/workspace/WorkspaceProvider';
import { openComposeWindow } from '../shared/lib/composeWindow';

const EMPTY_ACCOUNTS: AccountStatus[] = [];

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function AppShell() {
  const { session, logout } = useAuth();
  const accountsQuery = useAccountsQuery(Boolean(session));
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const workspace = useWorkspace();
  const removeAccount = useDeleteAccountMutation();
  const statsQuery = useDashboardStatsQuery(14, Boolean(session));
  const { syncAll, syncingIds } = useSync();
  const [editing, setEditing] = useState<AccountStatus | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);

  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts]);
  const unreadByTag = useMemo(
    () => new Map((statsQuery.data?.unreadByTag ?? []).map((row) => [row.tag, row.count])),
    [statsQuery.data?.unreadByTag],
  );

  useEffect(() => {
    if (accountsQuery.data) {
      workspace.reconcileAccounts(accountsQuery.data.map((account) => account.id));
    }
  }, [accountsQuery.data]);

  const openCompose = (next?: ComposeState) => {
    const account = (
      next
        ? accounts.find((item) => item.id === next.accountId)
        : workspace.accountScope
          ? accounts.find((item) => item.id === workspace.accountScope)
          : accounts[0]
    ) ?? accounts[0];
    if (!account) return;
    const state: ComposeState = next ?? {
      accountId: account.id,
      draft: buildComposeDraft('new'),
    };
    void openComposeWindow(state).then((opened) => {
      if (!opened) setCompose(state);
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openCompose();
        return;
      }
      if (compose) return;
      const opt = event.altKey;
      if (opt && !event.metaKey && !event.ctrlKey) {
        if (event.code === 'Digit1') {
          event.preventDefault();
          workspace.openDashboard();
          return;
        }
        if (event.code === 'Digit2') {
          event.preventDefault();
          workspace.openAll();
          return;
        }
        const digit = Number(event.code.replace('Digit', ''));
        if (digit >= 3 && digit <= 9) {
          const tag = PRIMARY_NAV_TAGS[digit - 3];
          if (tag) {
            event.preventDefault();
            workspace.openTag(tag);
          }
          return;
        }
        if (event.code === 'KeyK') {
          event.preventDefault();
          workspace.openTagPalette();
          return;
        }
        if (event.code === 'ArrowLeft') {
          event.preventDefault();
          workspace.cycleAccountScope(accountIds, -1);
          return;
        }
        if (event.code === 'ArrowRight') {
          event.preventDefault();
          workspace.cycleAccountScope(accountIds, 1);
        }
      }
      if (event.key === 'Escape') {
        if (workspace.tagPaletteOpen) workspace.closeTagPalette();
        else if (workspace.selected) workspace.clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [accountIds, compose, workspace, accounts]);

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
        <div>
          <Text c="red">{errorMessage(accountsQuery.error)}</Text>
          <Button mt="md" onClick={() => void accountsQuery.refetch()}>Повторить</Button>
        </div>
      </Center>
    );
  }

  const activeTag = workspace.screen.kind === 'tag' ? workspace.screen.tag : null;
  const mailMode = workspace.screen.kind !== 'dashboard';
  const scopedAccount = workspace.accountScope
    ? accounts.find((account) => account.id === workspace.accountScope)
    : null;

  return (
    <main className="app-shell">
      <header className="app-titlebar">
        <div className="app-titlebar-left">
          <WindowTrafficLights vertical={false} className="app-traffic" />
        </div>
        <div className="app-titlebar-drag" aria-hidden />
        <div className="app-titlebar-right">
          <button
            type="button"
            className="titlebar-refresh"
            title="Обновить"
            disabled={!accounts.length || syncingIds.size > 0}
            onClick={() => void syncAll().catch((reason) => setError(errorMessage(reason)))}
          >
            {syncingIds.size > 0 ? <span className="lb-spinner" /> : '↻'}
          </button>
        </div>
      </header>

      <aside className="app-rail" aria-label="Навигация">
        <div className="rail-group">
          <button
            type="button"
            className={workspace.screen.kind === 'dashboard' ? 'rail-btn active' : 'rail-btn'}
            title="Дашборд · ⌥1"
            onClick={() => workspace.openDashboard()}
          >
            ⌂
          </button>
          <button
            type="button"
            className={workspace.screen.kind === 'all' ? 'rail-btn active' : 'rail-btn'}
            title="Все письма · ⌥2"
            onClick={() => workspace.openAll()}
          >
            ∗
          </button>
        </div>

        <div className="rail-divider" aria-hidden />

        <div className="rail-group rail-tags">
          {PRIMARY_NAV_TAGS.map((tag, index) => {
            const unread = unreadByTag.get(tag) ?? 0;
            const ink = tagColor(tag);
            const bg = tagBg(tag);
            const active = activeTag === tag;
            return (
              <button
                type="button"
                key={tag}
                className={active ? 'rail-btn tag active' : 'rail-btn tag'}
                style={active
                  ? {
                    ['--tag-ink' as string]: ink,
                    ['--tag-bg' as string]: bg,
                    color: ink,
                    background: bg,
                  }
                  : {
                    ['--tag-ink' as string]: ink,
                    color: ink,
                  }}
                title={`${tagLabel(tag)}${unread > 0 ? ` · ${unread}` : ''} · ⌥${index + 3}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => workspace.openTag(tag)}
              >
                {tagGlyph(tag)}
                {unread > 0 && <span className="rail-badge">{formatCount(unread)}</span>}
                {scopedAccount && active && (
                  <span
                    className="rail-scope-dot"
                    style={{ background: accountColor(scopedAccount.id).accent }}
                  />
                )}
              </button>
            );
          })}
          <button
            type="button"
            className="rail-btn rail-add-tag"
            title="Палитра тегов · ⌥K"
            onClick={() => workspace.openTagPalette()}
          >
            +
          </button>
        </div>

        <div className="rail-group rail-accounts">
          {accounts.map((account) => {
            const color = accountColor(account.id);
            const active = workspace.accountScope === account.id;
            return (
              <button
                type="button"
                key={account.id}
                className={active ? 'rail-account-dot active' : 'rail-account-dot'}
                style={{ ['--account-color' as string]: color.accent }}
                title={`${account.email}${active ? ' · фильтр активен' : ''}`}
                onClick={() => workspace.setAccountScope(active ? null : account.id)}
              >
                <span />
              </button>
            );
          })}
        </div>

        <div className="rail-group rail-end">
          <button
            type="button"
            className="rail-btn rail-compose"
            title="Написать · ⌘N"
            onClick={() => openCompose()}
          >
            ✎
          </button>
          <button
            type="button"
            className="rail-btn"
            title={`Выйти · ${session.user.email}`}
            onClick={() => {
              if (!window.confirm('Выйти из аккаунта Letter Box?')) return;
              void logout();
            }}
          >
            ⎋
          </button>
        </div>
      </aside>

      <div className="app-main">
        {error && <div className="error-banner">{error}</div>}
        {workspace.screen.kind === 'dashboard' ? (
          <DashboardPage
            accounts={accounts}
            onAdd={() => setEditing('new')}
            onReconnect={setEditing}
            onDelete={(account) => {
              if (!window.confirm(`Удалить аккаунт ${account.email} и все его локальные данные?`)) return;
              removeAccount.mutate(account.id, {
                onError: (reason) => setError(errorMessage(reason)),
              });
            }}
          />
        ) : (
          <MailSectionPage
            accounts={accounts}
            onCompose={openCompose}
            mode={
              workspace.screen.kind === 'tag'
                ? { kind: 'tag', tag: workspace.screen.tag }
                : workspace.screen.kind === 'unread'
                  ? { kind: 'unread' }
                  : { kind: 'all' }
            }
          />
        )}
      </div>

      <TagPalette
        opened={workspace.tagPaletteOpen}
        accounts={accounts}
        onClose={() => workspace.closeTagPalette()}
        onSelect={(tag, accountId) => workspace.openTag(tag, accountId ?? null)}
      />

      {compose && (
        <ComposeDialog
          accounts={accounts}
          state={compose}
          onClose={() => setCompose(null)}
          onChangeAccount={(accountId) => setCompose((current) => (
            current ? { ...current, accountId } : current
          ))}
        />
      )}

      <AccountDialog
        current={editing === 'new' ? null : editing}
        opened={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          if (!mailMode) workspace.openDashboard();
        }}
      />
    </main>
  );
}
