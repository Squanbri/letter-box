import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const TABS_KEY = 'letter-box.open-account-tabs';
const ACTIVE_KEY = 'letter-box.active-tab';

export type UnifiedView =
  | { kind: 'unread' }
  | { kind: 'tag'; tag: string };

interface WorkspaceContextValue {
  active: string;
  tabs: string[];
  setActive: (id: string) => void;
  openAccount: (id: string) => void;
  openUnified: (view: UnifiedView) => void;
  closeAccount: (id: string) => void;
  moveTab: (fromId: string, toId: string) => void;
  reconcileAccounts: (ids: string[]) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function unifiedTabId(view: UnifiedView): string {
  return view.kind === 'unread' ? 'unified:unread' : `unified:tag:${view.tag}`;
}

export function parseUnifiedTab(id: string): UnifiedView | null {
  if (id === 'unified:unread') return { kind: 'unread' };
  if (id.startsWith('unified:tag:')) {
    const tag = id.slice('unified:tag:'.length);
    return tag ? { kind: 'tag', tag } : null;
  }
  return null;
}

export function isUnifiedTab(id: string): boolean {
  return parseUnifiedTab(id) !== null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // Cold start: only the dashboard tab. Open mail tabs are session-only.
  const [tabs, setTabs] = useState<string[]>(() => {
    localStorage.removeItem(TABS_KEY);
    return [];
  });
  const [active, setActive] = useState('overview');

  useEffect(() => localStorage.setItem(TABS_KEY, JSON.stringify(tabs)), [tabs]);
  useEffect(() => localStorage.setItem(ACTIVE_KEY, active), [active]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    active,
    tabs,
    setActive,
    openAccount: (id) => {
      setTabs((current) => current.includes(id) ? current : [...current, id]);
      setActive(id);
    },
    openUnified: (view) => {
      const id = unifiedTabId(view);
      setTabs((current) => current.includes(id) ? current : [...current, id]);
      setActive(id);
    },
    closeAccount: (id) => {
      setTabs((current) => current.filter((item) => item !== id));
      setActive((current) => current === id ? 'overview' : current);
    },
    moveTab: (fromId, toId) => {
      if (fromId === toId) return;
      setTabs((current) => {
        const from = current.indexOf(fromId);
        const to = current.indexOf(toId);
        if (from < 0 || to < 0) return current;
        const next = [...current];
        const [item] = next.splice(from, 1);
        if (!item) return current;
        next.splice(to, 0, item);
        return next;
      });
    },
    reconcileAccounts: (ids) => {
      const idSet = new Set(ids);
      setTabs((current) => {
        const next = current.filter((id) => isUnifiedTab(id) || idSet.has(id));
        return next.length === current.length ? current : next;
      });
      setActive((current) => (
        current === 'overview' || isUnifiedTab(current) || idSet.has(current)
          ? current
          : 'overview'
      ));
    },
  }), [active, tabs]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace должен использоваться внутри WorkspaceProvider');
  return value;
}
