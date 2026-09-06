import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { MESSAGE_TAGS, type MessageTag } from '@letter-box/contracts';

const SCREEN_KEY = 'letter-box.screen';
const ACCOUNT_SCOPE_KEY = 'letter-box.account-scope';

export type AppScreen =
  | { kind: 'dashboard' }
  | { kind: 'all' }
  | { kind: 'tag'; tag: MessageTag }
  | { kind: 'unread' };

export type SelectedMessage = {
  accountId: string;
  mailbox: string;
  uid: number;
} | null;

interface WorkspaceContextValue {
  screen: AppScreen;
  accountScope: string | null;
  selected: SelectedMessage;
  tagPaletteOpen: boolean;
  setScreen: (screen: AppScreen) => void;
  setAccountScope: (accountId: string | null) => void;
  cycleAccountScope: (accountIds: string[], direction: 1 | -1) => void;
  selectMessage: (message: SelectedMessage) => void;
  clearSelection: () => void;
  openTagPalette: () => void;
  closeTagPalette: () => void;
  openTag: (tag: MessageTag, accountId?: string | null) => void;
  openUnread: () => void;
  openAll: () => void;
  openDashboard: () => void;
  reconcileAccounts: (ids: string[]) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function parseScreen(raw: string | null): AppScreen {
  if (!raw) return { kind: 'dashboard' };
  try {
    const parsed = JSON.parse(raw) as AppScreen;
    if (parsed?.kind === 'dashboard') return { kind: 'dashboard' };
    if (parsed?.kind === 'all') return { kind: 'all' };
    if (parsed?.kind === 'unread') return { kind: 'unread' };
    if (parsed?.kind === 'tag' && MESSAGE_TAGS.includes(parsed.tag)) {
      return { kind: 'tag', tag: parsed.tag };
    }
  } catch {
    /* ignore */
  }
  return { kind: 'dashboard' };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [screen, setScreenState] = useState<AppScreen>(() => parseScreen(localStorage.getItem(SCREEN_KEY)));
  const [accountScope, setAccountScopeState] = useState<string | null>(
    () => localStorage.getItem(ACCOUNT_SCOPE_KEY),
  );
  const [selected, setSelected] = useState<SelectedMessage>(null);
  const [tagPaletteOpen, setTagPaletteOpen] = useState(false);

  useEffect(() => localStorage.setItem(SCREEN_KEY, JSON.stringify(screen)), [screen]);
  useEffect(() => {
    if (accountScope) localStorage.setItem(ACCOUNT_SCOPE_KEY, accountScope);
    else localStorage.removeItem(ACCOUNT_SCOPE_KEY);
  }, [accountScope]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    screen,
    accountScope,
    selected,
    tagPaletteOpen,
    setScreen: (next) => {
      setScreenState(next);
      setSelected(null);
    },
    setAccountScope: (accountId) => {
      setAccountScopeState(accountId);
      setSelected(null);
    },
    cycleAccountScope: (accountIds, direction) => {
      if (accountIds.length === 0) return;
      setAccountScopeState((current) => {
        if (current === null) {
          return direction === 1 ? accountIds[0]! : accountIds[accountIds.length - 1]!;
        }
        const index = accountIds.indexOf(current);
        if (index < 0) return accountIds[0]!;
        const next = index + direction;
        if (next < 0 || next >= accountIds.length) return null;
        return accountIds[next]!;
      });
      setSelected(null);
    },
    selectMessage: setSelected,
    clearSelection: () => setSelected(null),
    openTagPalette: () => setTagPaletteOpen(true),
    closeTagPalette: () => setTagPaletteOpen(false),
    openTag: (tag, accountId) => {
      setScreenState({ kind: 'tag', tag });
      // Rail clicks omit accountId → reset scope; dashboard/palette may pass an id or null.
      setAccountScopeState(accountId !== undefined ? accountId : null);
      setSelected(null);
      setTagPaletteOpen(false);
    },
    openUnread: () => {
      setScreenState({ kind: 'unread' });
      setAccountScopeState(null);
      setSelected(null);
    },
    openAll: () => {
      setScreenState({ kind: 'all' });
      setAccountScopeState(null);
      setSelected(null);
    },
    openDashboard: () => {
      setScreenState({ kind: 'dashboard' });
      setAccountScopeState(null);
      setSelected(null);
    },
    reconcileAccounts: (ids) => {
      const idSet = new Set(ids);
      setAccountScopeState((current) => (current && !idSet.has(current) ? null : current));
      setSelected((current) => (
        current && !idSet.has(current.accountId) ? null : current
      ));
    },
  }), [screen, accountScope, selected, tagPaletteOpen]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace должен использоваться внутри WorkspaceProvider');
  return value;
}
