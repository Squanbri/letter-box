import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthSession } from '../../shared/api/client';
import { api, clearAuthSession, loadAuthSession } from '../../shared/api/client';
import { queryClient } from '../queryClient';

interface AuthContextValue {
  session: AuthSession | null | undefined;
  authenticate: (session: AuthSession) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);

  useEffect(() => {
    void loadAuthSession().then(setSession);
  }, []);

  useEffect(() => {
    const unauthorized = () => {
      queryClient.clear();
      setSession(null);
    };
    window.addEventListener('letter-box:unauthorized', unauthorized);
    return () => window.removeEventListener('letter-box:unauthorized', unauthorized);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    authenticate: (next) => {
      queryClient.clear();
      setSession(next);
    },
    logout: async () => {
      await api.logout().catch(() => undefined);
      await clearAuthSession();
      queryClient.clear();
      setSession(null);
    },
  }), [session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth должен использоваться внутри AuthProvider');
  return value;
}
