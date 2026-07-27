import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SyncResult } from '../../shared/api/client';
import { api, subscribeToServerEvents } from '../../shared/api/client';
import { showNewMailNotification } from '../../shared/lib/notifications';
import { useAccountsQuery, accountKeys } from '../accounts/accounts';
import { useAuth } from '../auth/AuthProvider';
import { mailKeys } from '../mail/mail';
import { usePreferences } from '../preferences/PreferencesProvider';

interface SyncContextValue {
  syncingIds: Set<string>;
  syncAccount: (accountId: string, mailbox?: string) => Promise<SyncResult>;
  syncAll: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { data: accounts = [] } = useAccountsQuery(Boolean(session));
  const { preferences } = usePreferences();
  const client = useQueryClient();
  const running = useRef(new Map<string, Promise<SyncResult>>());
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const accountsRef = useRef(accounts);
  const preferencesRef = useRef(preferences);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);
  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);

  const invalidate = useCallback(async (accountId: string, mailbox?: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: accountKeys.all }),
      client.invalidateQueries({ queryKey: ['mail', 'stats'] }),
      client.invalidateQueries({ queryKey: ['mail', 'inbox'] }),
      client.invalidateQueries({ queryKey: mailKeys.mailboxes(accountId) }),
      mailbox
        ? client.invalidateQueries({ queryKey: ['mail', accountId, 'messages', mailbox] })
        : client.invalidateQueries({ queryKey: ['mail', accountId, 'messages'] }),
      mailbox
        ? client.invalidateQueries({ queryKey: mailKeys.tags(accountId, mailbox) })
        : client.invalidateQueries({ queryKey: ['mail', accountId, 'tags'] }),
      client.invalidateQueries({ queryKey: ['mail', accountId, 'thread'] }),
    ]);
  }, [client]);

  const syncAccount = useCallback((accountId: string, mailbox = 'INBOX') => {
    const key = `${accountId}:${mailbox}`;
    const existing = running.current.get(key);
    if (existing) return existing;
    const task = api.sync(accountId, mailbox).then(async (result) => {
      await invalidate(accountId, mailbox);
      return result;
    }).finally(() => {
      running.current.delete(key);
      if (![...running.current.keys()].some((item) => item.startsWith(`${accountId}:`))) {
        setSyncingIds((current) => {
          const next = new Set(current);
          next.delete(accountId);
          return next;
        });
      }
    });
    running.current.set(key, task);
    setSyncingIds((current) => new Set(current).add(accountId));
    return task;
  }, [invalidate]);

  const syncAll = useCallback(async () => {
    const results = await Promise.allSettled(
      accountsRef.current.map((account) => syncAccount(account.id)),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) throw new Error(`Не удалось синхронизировать аккаунтов: ${failures.length}`);
  }, [syncAccount]);

  useEffect(() => {
    if (!session) return undefined;
    return subscribeToServerEvents(
      (event) => {
        if (event.type === 'sync.completed' || event.type === 'classification.completed') {
          void invalidate(event.accountId, event.mailbox);
        }
      },
      () => void client.invalidateQueries({ queryKey: accountKeys.all }),
    );
  }, [client, invalidate, session]);

  useEffect(() => {
    if (!session) return undefined;
    const backgroundSync = () => {
      if (!navigator.onLine) return;
      const settings = preferencesRef.current;
      for (const account of accountsRef.current) {
        if (settings.disabledAccountIds.includes(account.id)) continue;
        void syncAccount(account.id).then((result) => {
          if (settings.notifications && account.lastSyncAt && result.added > 0) {
            showNewMailNotification(account, result.added);
          }
        }).catch(() => undefined);
      }
    };
    const initial = window.setTimeout(backgroundSync, 10_000);
    const interval = window.setInterval(
      backgroundSync,
      preferences.intervalMinutes * 60_000,
    );
    window.addEventListener('online', backgroundSync);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener('online', backgroundSync);
    };
  }, [preferences.intervalMinutes, session, syncAccount]);

  const value = useMemo(
    () => ({ syncingIds, syncAccount, syncAll }),
    [syncAccount, syncAll, syncingIds],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync должен использоваться внутри SyncProvider');
  return value;
}
