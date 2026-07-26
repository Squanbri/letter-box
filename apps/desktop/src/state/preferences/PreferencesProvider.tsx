import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { requestNotificationSetting } from '../../shared/lib/notifications';

const STORAGE_KEY = 'letter-box.background-sync';

export interface Preferences {
  intervalMinutes: number;
  disabledAccountIds: string[];
  notifications: boolean;
}

interface PreferencesContextValue {
  preferences: Preferences;
  setIntervalMinutes: (minutes: number) => void;
  setAccountSync: (id: string, enabled: boolean) => void;
  setNotifications: (enabled: boolean) => Promise<void>;
}

const fallback: Preferences = {
  intervalMinutes: 5,
  disabledAccountIds: [],
  notifications: false,
};

function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Preferences>;
    return {
      intervalMinutes: [5, 15, 30].includes(value.intervalMinutes ?? 0)
        ? value.intervalMinutes!
        : fallback.intervalMinutes,
      disabledAccountIds: Array.isArray(value.disabledAccountIds)
        ? value.disabledAccountIds.filter((id): id is string => typeof id === 'string')
        : [],
      notifications: value.notifications === true,
    };
  } catch {
    return fallback;
  }
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)), [preferences]);

  const value = useMemo<PreferencesContextValue>(() => ({
    preferences,
    setIntervalMinutes: (intervalMinutes) =>
      setPreferences((current) => ({ ...current, intervalMinutes })),
    setAccountSync: (id, enabled) => setPreferences((current) => ({
      ...current,
      disabledAccountIds: enabled
        ? current.disabledAccountIds.filter((item) => item !== id)
        : [...new Set([...current.disabledAccountIds, id])],
    })),
    setNotifications: async (enabled) => {
      const notifications = await requestNotificationSetting(enabled);
      setPreferences((current) => ({ ...current, notifications }));
    },
  }), [preferences]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences должен использоваться внутри PreferencesProvider');
  return value;
}
