import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const TABS_KEY = 'letter-box.open-account-tabs';
const ACTIVE_KEY = 'letter-box.active-tab';

interface WorkspaceContextValue {
  active: string;
  tabs: string[];
  setActive: (id: string) => void;
  openAccount: (id: string) => void;
  closeAccount: (id: string) => void;
  reconcileAccounts: (ids: string[]) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readTabs() {
  try {
    const value = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<string[]>(readTabs);
  const [active, setActive] = useState(() => localStorage.getItem(ACTIVE_KEY) ?? 'overview');

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
    closeAccount: (id) => {
      setTabs((current) => current.filter((item) => item !== id));
      setActive((current) => current === id ? 'overview' : current);
    },
    reconcileAccounts: (ids) => {
      const idSet = new Set(ids);
      setTabs((current) => {
        const next = current.filter((id) => idSet.has(id));
        return next.length === current.length ? current : next;
      });
      setActive((current) => current === 'overview' || idSet.has(current) ? current : 'overview');
    },
  }), [active, tabs]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace должен использоваться внутри WorkspaceProvider');
  return value;
}
