import { useEffect, useMemo, useState } from 'react';
import { Button, Text, Title } from '@mantine/core';
import type { AccountStatus, MailboxInfo, Message } from '../../shared/api/client';
import { errorMessage, isSeen, mailboxTitle } from '../../shared/lib/format';
import { ErrorBanner } from '../../shared/ui/AsyncState';
import {
  useMailboxesQuery,
  useMessageActions,
  useMessageQuery,
  useMessagesQuery,
  useSyncStatusQuery,
} from '../../state/mail/mail';
import { useSync } from '../../state/sync/SyncProvider';
import { MailboxSidebar } from './components/MailboxSidebar';
import { MessageList } from './components/MessageList';
import { MessageViewer } from './components/MessageViewer';

const fallbackMailboxes: MailboxInfo[] = [{
  path: 'INBOX',
  name: 'Входящие',
  delimiter: '/',
  specialUse: '\\Inbox',
  totalCount: 0,
  unreadCount: 0,
}];

export function MailboxPage({ account }: { account: AccountStatus }) {
  const [selectedMailbox, setSelectedMailbox] = useState(
    () => localStorage.getItem(`letter-box.mailbox.${account.id}`) ?? 'INBOX',
  );
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mailboxesQuery = useMailboxesQuery(account.id);
  const mailboxes = mailboxesQuery.data?.length ? mailboxesQuery.data : fallbackMailboxes;
  const messagesQuery = useMessagesQuery(account.id, selectedMailbox);
  const messages = useMemo(
    () => messagesQuery.data?.pages.flat() ?? [],
    [messagesQuery.data],
  );
  const selectedPreview = messages.find((message) => message.uid === selectedUid) ?? null;
  const messageQuery = useMessageQuery(account.id, selectedMailbox, selectedUid);
  const selected = messageQuery.data ?? selectedPreview;
  const syncStatus = useSyncStatusQuery(account.id);
  const { syncingIds, syncAccount } = useSync();
  const actions = useMessageActions(account.id);

  useEffect(() => {
    localStorage.setItem(`letter-box.mailbox.${account.id}`, selectedMailbox);
    setSelectedUid(null);
  }, [account.id, selectedMailbox]);

  useEffect(() => {
    if (!mailboxes.some((mailbox) => mailbox.path === selectedMailbox)) {
      setSelectedMailbox(
        mailboxes.find((mailbox) => mailbox.specialUse === '\\Inbox')?.path
        ?? mailboxes[0]?.path
        ?? 'INBOX',
      );
    }
  }, [mailboxes, selectedMailbox]);

  useEffect(() => {
    void syncAccount(account.id, selectedMailbox).catch((reason) => setError(errorMessage(reason)));
  }, [account.id, selectedMailbox, syncAccount]);

  const syncingMailboxes = new Set(syncStatus.data?.mailboxes ?? []);
  if (syncingIds.has(account.id)) syncingMailboxes.add('INBOX');
  const currentSyncing = syncingMailboxes.has(selectedMailbox);
  const pending = actions.move.isPending || actions.archive.isPending || actions.remove.isPending;
  const mutationError = actions.seen.error
    ?? actions.flagged.error
    ?? actions.move.error
    ?? actions.archive.error
    ?? actions.remove.error;
  const visibleError = error
    ?? (mailboxesQuery.error ? errorMessage(mailboxesQuery.error) : null)
    ?? (messagesQuery.error ? errorMessage(messagesQuery.error) : null)
    ?? (mutationError ? errorMessage(mutationError) : null);

  const openMessage = (message: Message) => {
    setSelectedUid(message.uid);
    if (!isSeen(message)) actions.seen.mutate({ message, value: true });
  };

  return (
    <section className={visibleError ? 'mail-page has-error' : 'mail-page'}>
      <header className="page-header">
        <div><Title order={1}>{mailboxTitle(mailboxes, selectedMailbox)}</Title><Text size="xs" c="dimmed">{account.email}</Text></div>
        <Button loading={currentSyncing} onClick={() => void syncAccount(account.id, selectedMailbox).catch((reason) => setError(errorMessage(reason)))}>Обновить</Button>
      </header>
      {visibleError && <ErrorBanner message={visibleError} />}
      <div className="mail-layout">
        <MailboxSidebar mailboxes={mailboxes} selected={selectedMailbox} syncing={syncingMailboxes} onSelect={setSelectedMailbox} />
        <MessageList
          messages={messages}
          selectedUid={selectedUid}
          loading={messagesQuery.isLoading || currentSyncing}
          fetchingMore={messagesQuery.isFetchingNextPage}
          hasMore={messagesQuery.hasNextPage}
          onOpen={openMessage}
          onLoadMore={() => void messagesQuery.fetchNextPage()}
        />
        <MessageViewer
          message={selected}
          mailboxes={mailboxes}
          loading={messageQuery.isLoading}
          pending={pending}
          seenPending={actions.seen.isPending}
          flaggedPending={actions.flagged.isPending}
          onSeen={(message, value) => actions.seen.mutate({ message, value })}
          onFlagged={(message, value) => actions.flagged.mutate({ message, value })}
          onMove={(message, destination) => actions.move.mutate(
            { message, destination },
            { onSuccess: () => setSelectedUid(null) },
          )}
          onArchive={(message) => actions.archive.mutate(message, { onSuccess: () => setSelectedUid(null) })}
          onDelete={(message, permanent) => {
            if (permanent && !window.confirm('Удалить письмо окончательно?')) return;
            actions.remove.mutate(message, { onSuccess: () => setSelectedUid(null) });
          }}
        />
      </div>
    </section>
  );
}
