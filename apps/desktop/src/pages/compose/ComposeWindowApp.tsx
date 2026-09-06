import { useEffect, useState } from 'react';
import { Center, Loader, Text, Button } from '@mantine/core';
import { ComposeDialog, type ComposeState } from '../mailbox/components/ComposeDialog';
import { useAccountsQuery } from '../../state/accounts/accounts';
import { useAuth } from '../../state/auth/AuthProvider';
import { AuthPage } from '../auth/AuthPage';
import { loadComposePayload } from '../../shared/lib/composeWindow';
import { errorMessage } from '../../shared/lib/format';

export function ComposeWindowApp({ composeId }: { composeId: string }) {
  const { session } = useAuth();
  const accountsQuery = useAccountsQuery(Boolean(session));
  const [state, setState] = useState<ComposeState | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadComposePayload(composeId)
      .then((payload) => {
        if (!cancelled) setState(payload);
      })
      .catch((reason) => {
        if (!cancelled) {
          setLoadError(errorMessage(reason));
          setState(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [composeId]);

  const closeWindow = () => {
    void window.letterBoxCompose?.close(composeId);
    window.close();
  };

  if (session === undefined || state === undefined || accountsQuery.isLoading) {
    return <Center h="100vh"><Loader /></Center>;
  }
  if (!session) return <AuthPage />;
  if (loadError || !state) {
    return (
      <Center h="100vh">
        <div>
          <Text c="red">{loadError ?? 'Черновик не найден'}</Text>
          <Button mt="md" onClick={closeWindow}>Закрыть</Button>
        </div>
      </Center>
    );
  }
  if (accountsQuery.error) {
    return (
      <Center h="100vh">
        <Text c="red">{errorMessage(accountsQuery.error)}</Text>
      </Center>
    );
  }

  return (
    <ComposeDialog
      windowMode
      accounts={accountsQuery.data ?? []}
      state={state}
      onChangeAccount={(accountId) => setState((current) => (
        current ? { ...current, accountId } : current
      ))}
      onClose={closeWindow}
      onSent={closeWindow}
    />
  );
}
