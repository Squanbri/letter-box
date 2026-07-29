import { useState, useEffect, useRef } from 'react';
import { Button, Group, Select, Stack, Text, Title } from '@mantine/core';
import type { MailboxInfo, Message } from '../../../shared/api/client';
import { prepareEmailHtml } from '../../../shared/lib/email-html';
import { isSeen, mailboxDisplayName, tagLabel } from '../../../shared/lib/format';
import { EmptyState, LoadingState } from '../../../shared/ui/AsyncState';

function AutoIframe({ srcDoc, title }: { srcDoc: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  const resize = () => {
    const frame = ref.current;
    if (!frame?.contentDocument?.body) return;
    // Let the content determine its own height
    frame.style.height = '0';
    frame.style.height = `${frame.contentDocument.documentElement.scrollHeight}px`;
  };

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    frame.addEventListener('load', resize);
    return () => frame.removeEventListener('load', resize);
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      style={{ width: '100%', border: 0, display: 'block', background: 'white' }}
    />
  );
}

export function MessageViewer({
  message,
  thread,
  mailboxes,
  loading,
  threadLoading,
  pending,
  seenPending,
  flaggedPending,
  onOpenThreadMessage,
  onReply,
  onForward,
  onSeen,
  onFlagged,
  onMove,
  onArchive,
  onDelete,
}: {
  message: Message | null;
  thread: Message[];
  mailboxes: MailboxInfo[];
  loading: boolean;
  threadLoading: boolean;
  pending: boolean;
  seenPending: boolean;
  flaggedPending: boolean;
  onOpenThreadMessage: (message: Message) => void;
  onReply: (message: Message) => void;
  onForward: (message: Message) => void;
  onSeen: (message: Message, value: boolean) => void;
  onFlagged: (message: Message, value: boolean) => void;
  onMove: (message: Message, destination: string) => void;
  onArchive: (message: Message) => void;
  onDelete: (message: Message, permanent: boolean) => void;
}) {
  const [headerVisible, setHeaderVisible] = useState(true);

  if (!message) return <article className="message-view"><EmptyState text="Выберите письмо" /></article>;
  const archiveAvailable = mailboxes.some(
    (mailbox) => mailbox.specialUse === '\\Archive' && mailbox.path !== message.mailbox,
  );
  const trash = mailboxes.find((mailbox) => mailbox.specialUse === '\\Trash');
  const permanent = trash?.path === message.mailbox;
  const threadItems = thread.length > 1 ? thread : [];

  return (
    <article className="message-view">
      <div className="message-canvas">
        {(threadLoading || threadItems.length > 0) && (
          <section className="thread-panel" aria-label="Ветка диалога">
            <header>
              <span className="eyebrow">Ветка диалога</span>
              <strong>
                {threadLoading ? '…' : `${threadItems.length} писем`}
              </strong>
            </header>
            {!threadLoading && (
              <ol className="thread-list">
                {threadItems.map((item) => {
                  const active = item.mailbox === message.mailbox && item.uid === message.uid;
                  return (
                    <li key={`${item.mailbox}:${item.uid}`}>
                      <button
                        type="button"
                        className={active ? 'thread-item active' : 'thread-item'}
                        onClick={() => onOpenThreadMessage(item)}
                      >
                        <span className="thread-from">
                          {item.from.name || item.from.address || 'Без отправителя'}
                        </span>
                        <span className="thread-meta">
                          <time>{new Date(item.date).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}</time>
                          {item.mailbox !== message.mailbox && (
                            <small>{mailboxDisplayName(
                              mailboxes.find((mailbox) => mailbox.path === item.mailbox)
                              ?? { path: item.mailbox, name: item.mailbox, delimiter: '/', specialUse: null, totalCount: 0, unreadCount: 0 },
                            )}</small>
                          )}
                        </span>
                        <span className="thread-snippet">{item.subject || 'Без темы'}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
        <div className="message-header-wrap">
          {headerVisible && (
            <>
              <header className="message-header">
                <Stack gap="xs">
                  <Title order={2}>{message.subject || 'Без темы'}</Title>
                  {(message.tags?.length ?? 0) > 0 && (
                    <Group gap={6}>
                      {message.tags.map((tag) => (
                        <span key={tag} className={`message-tag message-tag--${tag}`}>{tagLabel(tag)}</span>
                      ))}
                    </Group>
                  )}
                  <div className="sender-details">
                    <Text fw={600}>{message.from.name || message.from.address}</Text>
                    <Text size="sm" c="dimmed">{message.from.address}</Text>
                    <time>{new Date(message.date).toLocaleString('ru-RU')}</time>
                  </div>
                </Stack>
              </header>
              <div className="message-actions-bar">
                <Group gap="xs" wrap="wrap">
            <Button
              size="xs"
              variant="light"
              color="gray"
              disabled={loading}
              onClick={() => onReply(message)}
            >
              Ответить
            </Button>
            <Button
              size="xs"
              variant="light"
              color="gray"
              disabled={loading}
              onClick={() => onForward(message)}
            >
              Переслать
            </Button>
            <Button
              size="xs"
              variant="light"
              color="gray"
              loading={flaggedPending}
              disabled={flaggedPending || seenPending}
              onClick={() => onFlagged(message, !message.flags.includes('\\Flagged'))}
            >
              {message.flags.includes('\\Flagged') ? '★ Важное' : '☆ Важное'}
            </Button>
            <Button
              size="xs"
              variant="light"
              color="gray"
              loading={seenPending}
              disabled={seenPending || flaggedPending}
              onClick={() => onSeen(message, !isSeen(message))}
            >
              {isSeen(message) ? 'Не прочитано' : 'Прочитано'}
            </Button>
            {archiveAvailable && <Button size="xs" variant="light" color="gray" disabled={pending} onClick={() => onArchive(message)}>Архив</Button>}
            <Select
              size="xs"
              w={150}
              placeholder="Переместить…"
              disabled={pending}
              data={mailboxes
                .filter((mailbox) => mailbox.path !== message.mailbox)
                .map((mailbox) => ({ value: mailbox.path, label: mailboxDisplayName(mailbox) }))}
              onChange={(destination) => destination && onMove(message, destination)}
            />
            <Button size="xs" variant="light" color="red" disabled={pending} onClick={() => onDelete(message, permanent)}>
              Удалить
            </Button>
                </Group>
              </div>
            </>
          )}
          <button
            className="message-header-toggle"
            title={headerVisible ? 'Скрыть шапку' : 'Показать шапку'}
            onClick={() => setHeaderVisible((v) => !v)}
          >
            {headerVisible ? '▲' : '▼ ' + (message.subject || 'Без темы')}
          </button>
        </div>
        <div className="message-body">
          {loading
            ? <LoadingState text="Загрузка письма…" />
            : message.body?.html
              ? <AutoIframe title={message.subject || 'Письмо'} srcDoc={prepareEmailHtml(message.body.html)} />
              : <pre>{message.body?.text || 'Пустое письмо'}</pre>}
        </div>
      </div>
    </article>
  );
}
