import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Group, Text, Title } from '@mantine/core';
import { MESSAGE_TAGS } from '@letter-box/contracts';
import type { AccountStatus, MailboxInfo, Message } from '../../shared/api/client';
import { errorMessage, isSeen, mailboxTitle, tagLabel } from '../../shared/lib/format';
import { ErrorBanner } from '../../shared/ui/AsyncState';
import {
  useMailboxesQuery,
  useMessageActions,
  useMessageQuery,
  useMessageThreadQuery,
  useMessagesQuery,
  useSyncStatusQuery,
  useTagCountsQuery,
} from '../../state/mail/mail';
import { useSync } from '../../state/sync/SyncProvider';
import {
  buildComposeDraft,
  ComposeDialog,
  type ComposeDraft,
} from './components/ComposeDialog';
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
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composeDraft, setComposeDraft] = useState<ComposeDraft | null>(null);
  const preserveSelectionRef = useRef(false);
  const mailboxesQuery = useMailboxesQuery(account.id);
  const mailboxes = mailboxesQuery.data?.length ? mailboxesQuery.data : fallbackMailboxes;
  const messagesQuery = useMessagesQuery(account.id, selectedMailbox, selectedTag);
  const tagCountsQuery = useTagCountsQuery(account.id, selectedMailbox);
  const messages = useMemo(
    () => messagesQuery.data?.pages.flat() ?? [],
    [messagesQuery.data],
  );
  const selectedPreview = messages.find((message) => message.uid === selectedUid) ?? null;
  const messageQuery = useMessageQuery(account.id, selectedMailbox, selectedUid);
  const selected = messageQuery.data ?? selectedPreview;
  const threadQuery = useMessageThreadQuery(
    account.id,
    selectedMailbox,
    selectedUid,
    Boolean(selected?.threadId || selected?.messageId),
  );
  const thread = threadQuery.data ?? (selected ? [selected] : []);
  const syncStatus = useSyncStatusQuery(account.id);
  const { syncingIds, syncAccount } = useSync();
  const actions = useMessageActions(account.id);
  const tagCounts = useMemo(() => {
    const map = new Map((tagCountsQuery.data ?? []).map((item) => [item.tag, item.count]));
    return MESSAGE_TAGS
      .map((tag) => ({ tag, count: map.get(tag) ?? 0 }))
      .filter((item) => item.count > 0 || item.tag === selectedTag);
  }, [selectedTag, tagCountsQuery.data]);

  useEffect(() => {
    localStorage.setItem(`letter-box.mailbox.${account.id}`, selectedMailbox);
    if (preserveSelectionRef.current) {
      preserveSelectionRef.current = false;
      return;
    }
    setSelectedUid(null);
    setSelectedTag(null);
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
    if (message.mailbox !== selectedMailbox) {
      preserveSelectionRef.current = true;
      setSelectedMailbox(message.mailbox);
    }
    setSelectedUid(message.uid);
    if (!isSeen(message)) actions.seen.mutate({ message, value: true });
  };

  return (
    <section className={visibleError ? 'mail-page has-error' : 'mail-page'}>
      <header className="page-header">
        <div>
          <Title order={1}>{mailboxTitle(mailboxes, selectedMailbox)}</Title>
          <Text size="xs" c="dimmed">{account.email}</Text>
        </div>
        <Group gap="xs">
          <Button variant="light" onClick={() => setComposeDraft(buildComposeDraft('new'))}>
            Написать
          </Button>
          <Button
            loading={currentSyncing}
            onClick={() => void syncAccount(account.id, selectedMailbox).catch((reason) => setError(errorMessage(reason)))}
          >
            Обновить
          </Button>
        </Group>
      </header>
      {visibleError && <ErrorBanner message={visibleError} />}
      <div className="mail-layout">
        <MailboxSidebar mailboxes={mailboxes} selected={selectedMailbox} syncing={syncingMailboxes} onSelect={setSelectedMailbox} />
        <div className="message-column">
          {tagCounts.length > 0 && (
            <div className="tag-filters" aria-label="Фильтр по тегам">
              <button
                className={!selectedTag ? 'active' : ''}
                onClick={() => setSelectedTag(null)}
              >
                Все
              </button>
              {tagCounts.map(({ tag, count }) => (
                <button
                  key={tag}
                  className={selectedTag === tag ? 'active' : ''}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                >
                  {tagLabel(tag)}
                  <Badge size="xs" variant="light">{count}</Badge>
                </button>
              ))}
            </div>
          )}
          <MessageList
            messages={messages}
            selectedUid={selectedUid}
            loading={messagesQuery.isLoading || currentSyncing}
            fetchingMore={messagesQuery.isFetchingNextPage}
            hasMore={messagesQuery.hasNextPage}
            onOpen={openMessage}
            onLoadMore={() => void messagesQuery.fetchNextPage()}
          />
        </div>
        <MessageViewer
          message={selected}
          thread={thread}
          mailboxes={mailboxes}
          loading={messageQuery.isLoading}
          threadLoading={threadQuery.isLoading}
          pending={pending}
          seenPending={actions.seen.isPending}
          flaggedPending={actions.flagged.isPending}
          onOpenThreadMessage={openMessage}
          onReply={(message) => setComposeDraft(buildComposeDraft('reply', message))}
          onForward={(message) => setComposeDraft(buildComposeDraft('forward', message))}
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
      {composeDraft && (
        <ComposeDialog
          accountId={account.id}
          fromEmail={account.email}
          opened
          draft={composeDraft}
          onClose={() => setComposeDraft(null)}
        />
      )}
    </section>
  );
}
