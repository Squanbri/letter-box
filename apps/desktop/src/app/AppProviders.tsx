import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../state/auth/AuthProvider';
import { PreferencesProvider } from '../state/preferences/PreferencesProvider';
import { queryClient } from '../state/queryClient';
import { SyncProvider } from '../state/sync/SyncProvider';
import { WorkspaceProvider } from '../state/workspace/WorkspaceProvider';
import { theme } from './theme';

export function AppProviders({ children, dark }: { children: ReactNode; dark: boolean }) {
  return (
    <MantineProvider theme={theme} forceColorScheme={dark ? 'dark' : 'light'}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <WorkspaceProvider>
            <PreferencesProvider>
              <SyncProvider>{children}</SyncProvider>
            </PreferencesProvider>
          </WorkspaceProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MantineProvider>
  );
}
