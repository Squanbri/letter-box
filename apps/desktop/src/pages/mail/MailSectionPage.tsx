import { useMemo, useState } from 'react';
import { Button } from '@mantine/core';
import type { MessageTag } from '@letter-box/contracts';
import type { AccountStatus, Message } from '../../shared/api/client';
import { api } from '../../shared/api/client';
import { accountColor } from '../../shared/lib/accountColor';
import {
  dayBucketLabel,
  errorMessage,
  formatDate,
  isSeen,
  tagLabel,
} from '../../shared/lib/format';
import { tagBg, tagColor } from '../../shared/lib/tagColor';
import { EmptyState, ErrorBanner, LoadingState } from '../../shared/ui/AsyncState';
import {
  useInboxQuery,
  useMailboxesQuery,
  useMessageActions,
  useMessageQuery,
  useMessageThreadQuery,
} from '../../state/mail/mail';
import { useWorkspace } from '../../state/workspace/WorkspaceProvider';
import {
  buildComposeDraft,
  type ComposeState,
} from '../mailbox/components/ComposeDialog';
import { MessageViewer } from '../mailbox/components/MessageViewer';

export type MailSectionMode =
  | { kind: 'all' }
  | { kind: 'unread' }
  | { kind: 'tag'; tag: MessageTag };

export function MailSectionPage({
  accounts,
  mode,
  onCompose,
}: {
  accounts: AccountStatus[];
  mode: MailSectionMode;
  onCompose: (state: ComposeState) => void;
}) {
  const workspace = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);

  const inboxQuery = useInboxQuery({
    unread: mode.kind === 'unread' ? true : undefined,
    tag: mode.kind === 'tag' ? mode.tag : null,
    accountId: workspace.accountScope,
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

  const scopeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of messages) {
      counts.set(message.accountId, (counts.get(message.accountId) ?? 0) + 1);
    }
    return counts;
  }, [messages]);

  const selected = workspace.selected;
  const selectedAccount = selected ? accountById.get(selected.accountId) ?? null : null;
  const preview = selected
    ? messages.find(
      (message) =>
        message.accountId === selected.accountId
        && message.mailbox === selected.mailbox
        && message.uid === selected.uid,
    ) ?? null
    : null;

  const title = mode.kind === 'tag'
    ? tagLabel(mode.tag)
    : mode.kind === 'unread'
      ? 'Непрочитанные'
      : 'Все письма';
  const unreadCount = messages.filter((message) => !isSeen(message)).length;
  const expanded = !selected;
  const showAccountColumn = expanded && !workspace.accountScope;
  const groups = useMemo(() => groupByDay(messages), [messages]);

  const onOpen = (message: Message) => {
    workspace.selectMessage({
      accountId: message.accountId,
      mailbox: message.mailbox,
      uid: message.uid,
    });
    if (!isSeen(message)) {
      void api.setSeen(message.accountId, message.uid, true, message.mailbox)
        .then(() => inboxQuery.refetch())
        .catch(() => undefined);
    }
  };

  const markAllRead = async () => {
    const unread = messages.filter((message) => !isSeen(message));
    if (!unread.length) return;
    setMarkingRead(true);
    try {
      await Promise.all(unread.map((message) => (
        api.setSeen(message.accountId, message.uid, true, message.mailbox)
      )));
      await inboxQuery.refetch();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setMarkingRead(false);
    }
  };

  return (
    <section className={selected ? 'mail-section split' : 'mail-section'}>
      {error && <ErrorBanner message={error} />}
      <div className="mail-list-pane">
        <header className="mail-section-header">
          <div>
            <h1>
              {mode.kind === 'tag' && (
                <span className="tag-dot" style={{ background: tagColor(mode.tag) }} />
              )}
              {title}
            </h1>
            <p>
              {messages.length} писем
              {unreadCount > 0 ? ` · ${unreadCount} непрочитанных` : ''}
              {` · ${workspace.accountScope ? 1 : accounts.length} акк.`}
            </p>
          </div>
          <div className="mail-section-actions">
            {unreadCount > 0 && (
              <Button
                size="compact-xs"
                variant="subtle"
                loading={markingRead}
                onClick={() => void markAllRead()}
              >
                Прочитать все
              </Button>
            )}
            <Button size="compact-xs" variant="light" onClick={() => workspace.openTagPalette()}>
              ⌥K
            </Button>
          </div>
        </header>

        <div className="scope-bar" aria-label="Охват">
          <span className="scope-label">Охват</span>
          <button
            type="button"
            className={!workspace.accountScope ? 'scope-chip active' : 'scope-chip'}
            onClick={() => workspace.setAccountScope(null)}
          >
            Все аккаунты
            <em>{messages.length}</em>
          </button>
          {accounts.map((account) => {
            const color = accountColor(account.id);
            const count = scopeCounts.get(account.id) ?? 0;
            const active = workspace.accountScope === account.id;
            return (
              <button
                type="button"
                key={account.id}
                className={active ? 'scope-chip active' : 'scope-chip'}
                onClick={() => workspace.setAccountScope(account.id)}
              >
                <span className="account-dot" style={{ background: color.accent }} />
                {account.email}
                <em>{count}</em>
              </button>
            );
          })}
          <span className="scope-hint">⌥← → между аккаунтами</span>
        </div>

        {inboxQuery.isLoading ? (
          <LoadingState text="Загрузка писем…" />
        ) : messages.length === 0 ? (
          <EmptyState text="Писем пока нет" />
        ) : (
          <div
            className={expanded ? 'mail-table expanded' : 'mail-table'}
            onScroll={(event) => {
              const el = event.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 180) {
                if (inboxQuery.hasNextPage && !inboxQuery.isFetchingNextPage) {
                  void inboxQuery.fetchNextPage();
                }
              }
            }}
          >
            {expanded && (
              <div
                className={showAccountColumn ? 'mail-table-head' : 'mail-table-head no-account'}
              >
                <span />
                <span>Отправитель</span>
                <span>Тема</span>
                <span>AI-теги</span>
                {showAccountColumn && <span>Аккаунт</span>}
                <span>Дата</span>
              </div>
            )}
            {groups.map((group) => (
              <div key={group.label} className="mail-day-group">
                <div className="mail-day-label">{group.label}</div>
                {group.items.map((message) => {
                  const account = accountById.get(message.accountId);
                  const color = accountColor(message.accountId);
                  const active = selected?.accountId === message.accountId
                    && selected.mailbox === message.mailbox
                    && selected.uid === message.uid;
                  const unread = !isSeen(message);
                  return (
                    <button
                      type="button"
                      key={`${message.accountId}:${message.mailbox}:${message.uid}`}
                      className={[
                        'mail-row',
                        unread ? 'unread' : '',
                        active ? 'active' : '',
                        expanded ? 'expanded' : '',
                        expanded && !showAccountColumn ? 'no-account' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => onOpen(message)}
                    >
                      <span className="mail-row-unread">{unread ? '•' : ''}</span>
                      {!expanded && (
                        <span
                          className="account-dot"
                          style={{ background: color.accent }}
                          title={account?.email}
                        />
                      )}
                      <span className="mail-row-from">
                        {message.from.name || message.from.address || 'Без имени'}
                      </span>
                      <span className="mail-row-subject">
                        <strong>{message.subject || 'Без темы'}</strong>
                        {message.body?.text && (
                          <em>— {message.body.text.slice(0, 80)}</em>
                        )}
                      </span>
                      {expanded && (
                        <span className="mail-row-tags">
                          {message.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="ai-tag"
                              style={{
                                color: tagColor(tag),
                                background: tagBg(tag),
                              }}
                            >
                              {tagLabel(tag)}
                            </span>
                          ))}
                        </span>
                      )}
                      {showAccountColumn && (
                        <span className="mail-row-account">
                          <span className="account-dot" style={{ background: color.accent }} />
                          {account?.email ?? message.accountId}
                        </span>
                      )}
                      <span className="mail-row-date">{formatDate(message.date)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <footer className="mail-table-footer">
              <span>↑ ↓ выбрать · ⏎ открыть · ⌥K сменить тег</span>
              <span>показано {messages.length}</span>
            </footer>
          </div>
        )}
      </div>

      {selected && selectedAccount && (
        <div className="mail-reader-pane">
          <SelectedMessagePane
            account={selectedAccount}
            mailbox={selected.mailbox}
            uid={selected.uid}
            preview={preview}
            onSelect={(message) => workspace.selectMessage({
              accountId: message.accountId,
              mailbox: message.mailbox,
              uid: message.uid,
            })}
            onCompose={onCompose}
            onCleared={() => workspace.clearSelection()}
            onInboxChanged={() => void inboxQuery.refetch()}
          />
        </div>
      )}
    </section>
  );
}

function SelectedMessagePane({
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
  onCompose: (state: ComposeState) => void;
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

  return (
    <MessageViewer
      message={current}
      accountEmail={account.email}
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
      onReply={(message) => onCompose({
        accountId: account.id,
        draft: buildComposeDraft('reply', message),
        thread: thread.map((item) => ({
          id: `${item.accountId}:${item.mailbox}:${item.uid}`,
          from: item.from.name || item.from.address || 'Без имени',
          preview: item.subject || item.body?.text?.slice(0, 80) || '',
          date: formatDate(item.date),
          current: item.uid === message.uid && item.mailbox === message.mailbox,
        })),
        tagHint: message.tags[0] ? tagLabel(message.tags[0]) : null,
      })}
      onForward={(message) => onCompose({
        accountId: account.id,
        draft: buildComposeDraft('forward', message),
      })}
      onSeen={(message, value) => {
        actions.seen.mutate({ message, value }, { onSettled: onInboxChanged });
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

function groupByDay(messages: Message[]) {
  const groups: Array<{ label: string; items: Message[] }> = [];
  for (const message of messages) {
    const label = dayBucketLabel(message.date);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(message);
    else groups.push({ label, items: [message] });
  }
  return groups;
}
