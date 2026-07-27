import { useMemo, useState } from 'react';
import { Button, Group, Text, Title } from '@mantine/core';
import type { AccountStatus, Message } from '../../shared/api/client';
import { api } from '../../shared/api/client';
import { errorMessage, isSeen, tagLabel } from '../../shared/lib/format';
import { ErrorBanner } from '../../shared/ui/AsyncState';
import {
  useInboxQuery,
  useMailboxesQuery,
  useMessageActions,
  useMessageQuery,
  useMessageThreadQuery,
} from '../../state/mail/mail';
import type { UnifiedView } from '../../state/workspace/WorkspaceProvider';
import { useWorkspace } from '../../state/workspace/WorkspaceProvider';
import {
  buildComposeDraft,
  ComposeDialog,
  type ComposeDraft,
} from '../mailbox/components/ComposeDialog';
import { MessageList } from '../mailbox/components/MessageList';
import { MessageViewer } from '../mailbox/components/MessageViewer';

export function UnifiedInboxPage({
  view,
  accounts,
}: {
  view: UnifiedView;
  accounts: AccountStatus[];
}) {
  const { setActive } = useWorkspace();
  const [selected, setSelected] = useState<{
    accountId: string;
    mailbox: string;
    uid: number;
  } | null>(null);
  const [compose, setCompose] = useState<{
    accountId: string;
    draft: ComposeDraft;
  } | null>(null);

  const inboxQuery = useInboxQuery({
    unread: view.kind === 'unread' ? true : undefined,
    tag: view.kind === 'tag' ? view.tag : null,
  });
  const messages = useMemo(() => {
    const items = inboxQuery.data?.pages.flat() ?? [];
    return [...items].sort((left, right) => {
      const byDate = right.date.localeCompare(left.date);
      return byDate !== 0 ? byDate : right.uid - left.uid;
    });
  }, [inboxQuery.data]);
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const accountLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const account of accounts) labels.set(account.id, account.email);
    return labels;
  }, [accounts]);

  const title = view.kind === 'unread' ? 'Непрочитанные' : tagLabel(view.tag);
  const subtitle = view.kind === 'unread'
    ? 'Письма из всех аккаунтов'
    : `Тег «${tagLabel(view.tag)}» · все аккаунты`;
  const visibleError = inboxQuery.error ? errorMessage(inboxQuery.error) : null;
  const selectedAccount = selected
    ? accountById.get(selected.accountId) ?? null
    : null;

  return (
    <section className={visibleError ? 'mail-page has-error' : 'mail-page'}>
      <header className="page-header">
        <div>
          <Title order={1}>{title}</Title>
          <Text size="xs" c="dimmed">{subtitle}</Text>
        </div>
        <Group gap="xs">
          <Button variant="light" onClick={() => setActive('overview')}>К обзору</Button>
          <Button loading={inboxQuery.isFetching} onClick={() => void inboxQuery.refetch()}>
            Обновить
          </Button>
        </Group>
      </header>
      {visibleError && <ErrorBanner message={visibleError} />}
      <div className="mail-layout unified-layout">
        <div className="message-column">
          <MessageList
            messages={messages}
            selectedUid={selected?.uid ?? null}
            selectedKey={selected
              ? `${selected.accountId}:${selected.mailbox}:${selected.uid}`
              : null}
            accountLabels={accountLabels}
            loading={inboxQuery.isLoading}
            fetchingMore={inboxQuery.isFetchingNextPage}
            hasMore={Boolean(inboxQuery.hasNextPage)}
            onOpen={(message) => {
              setSelected({
                accountId: message.accountId,
                mailbox: message.mailbox,
                uid: message.uid,
              });
              if (!isSeen(message)) {
                void api.setSeen(
                  message.accountId,
                  message.uid,
                  true,
                  message.mailbox,
                ).then(() => inboxQuery.refetch()).catch(() => undefined);
              }
            }}
            onLoadMore={() => void inboxQuery.fetchNextPage()}
          />
        </div>
        {selectedAccount && selected ? (
          <UnifiedMessagePane
            account={selectedAccount}
            mailbox={selected.mailbox}
            uid={selected.uid}
            preview={messages.find((message) => (
              message.accountId === selected.accountId
              && message.mailbox === selected.mailbox
              && message.uid === selected.uid
            )) ?? null}
            onSelect={(message) => setSelected({
              accountId: message.accountId,
              mailbox: message.mailbox,
              uid: message.uid,
            })}
            onCompose={(accountId, draft) => setCompose({ accountId, draft })}
            onCleared={() => setSelected(null)}
            onInboxChanged={() => void inboxQuery.refetch()}
          />
        ) : (
          <article className="message-view">
            <div className="empty-state"><span>Выберите письмо</span></div>
          </article>
        )}
      </div>
      {compose && (
        <ComposeDialog
          accountId={compose.accountId}
          fromEmail={accountById.get(compose.accountId)?.email ?? ''}
          opened
          draft={compose.draft}
          onClose={() => setCompose(null)}
        />
      )}
    </section>
  );
}

function UnifiedMessagePane({
  account,
  mailbox,
  uid,
  preview,
  onSelect,
  onCompose,
  onCleared,
  onInboxChanged,
}: {
  account: AccountStatus;
  mailbox: string;
  uid: number;
  preview: Message | null;
  onSelect: (message: Message) => void;
  onCompose: (accountId: string, draft: ComposeDraft) => void;
  onCleared: () => void;
  onInboxChanged: () => void;
}) {
  const mailboxesQuery = useMailboxesQuery(account.id);
  const messageQuery = useMessageQuery(account.id, mailbox, uid);
  const current = messageQuery.data ?? preview;
  const threadQuery = useMessageThreadQuery(
    account.id,
    mailbox,
    uid,
    Boolean(current?.threadId || current?.messageId),
  );
  const thread = threadQuery.data ?? (current ? [current] : []);
  const actions = useMessageActions(account.id);
  const pending = actions.move.isPending || actions.archive.isPending || actions.remove.isPending;

  if (!current) {
    return (
      <article className="message-view">
        <div className="empty-state"><span>Выберите письмо</span></div>
      </article>
    );
  }

  return (
    <MessageViewer
      message={current}
      thread={thread}
      mailboxes={mailboxesQuery.data ?? []}
      loading={messageQuery.isLoading}
      threadLoading={threadQuery.isLoading}
      pending={pending}
      seenPending={actions.seen.isPending}
      flaggedPending={actions.flagged.isPending}
      onOpenThreadMessage={(message) => {
        if (message.accountId === account.id) onSelect(message);
      }}
      onReply={(message) => onCompose(account.id, buildComposeDraft('reply', message))}
      onForward={(message) => onCompose(account.id, buildComposeDraft('forward', message))}
      onSeen={(message, value) => {
        actions.seen.mutate(
          { message, value },
          { onSettled: onInboxChanged },
        );
      }}
      onFlagged={(message, value) => actions.flagged.mutate({ message, value })}
      onMove={(message, destination) => actions.move.mutate(
        { message, destination },
        { onSuccess: () => { onCleared(); onInboxChanged(); } },
      )}
      onArchive={(message) => actions.archive.mutate(message, {
        onSuccess: () => { onCleared(); onInboxChanged(); },
      })}
      onDelete={(message, permanent) => {
        if (permanent && !window.confirm('Удалить письмо окончательно?')) return;
        actions.remove.mutate(message, {
          onSuccess: () => { onCleared(); onInboxChanged(); },
        });
      }}
    />
  );
}
