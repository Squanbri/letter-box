import { Button, Group, Select, Stack, Text, Title } from '@mantine/core';
import type { MailboxInfo, Message } from '../../../shared/api/client';
import { prepareEmailHtml } from '../../../shared/lib/email-html';
import { isSeen, mailboxDisplayName, tagLabel } from '../../../shared/lib/format';
import { EmptyState, LoadingState } from '../../../shared/ui/AsyncState';

export function MessageViewer({
  message,
  mailboxes,
  loading,
  pending,
  seenPending,
  flaggedPending,
  onSeen,
  onFlagged,
  onMove,
  onArchive,
  onDelete,
}: {
  message: Message | null;
  mailboxes: MailboxInfo[];
  loading: boolean;
  pending: boolean;
  seenPending: boolean;
  flaggedPending: boolean;
  onSeen: (message: Message, value: boolean) => void;
  onFlagged: (message: Message, value: boolean) => void;
  onMove: (message: Message, destination: string) => void;
  onArchive: (message: Message) => void;
  onDelete: (message: Message, permanent: boolean) => void;
}) {
  if (!message) return <article className="message-view"><EmptyState text="Выберите письмо" /></article>;
  const archiveAvailable = mailboxes.some(
    (mailbox) => mailbox.specialUse === '\\Archive' && mailbox.path !== message.mailbox,
  );
  const trash = mailboxes.find((mailbox) => mailbox.specialUse === '\\Trash');
  const permanent = trash?.path === message.mailbox;

  return (
    <article className="message-view">
      <header className="message-header">
        <Stack gap="sm">
          <Title order={2}>{message.subject || 'Без темы'}</Title>
          {(message.tags?.length ?? 0) > 0 && (
            <Group gap={6}>
              {message.tags.map((tag) => (
                <span key={tag} className="message-tag">{tagLabel(tag)}</span>
              ))}
            </Group>
          )}
          <Group gap="xs">
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
          <div className="sender-details">
            <Text fw={600}>{message.from.name || message.from.address}</Text>
            <Text size="sm">{message.from.address}</Text>
            <time>{new Date(message.date).toLocaleString('ru-RU')}</time>
          </div>
        </Stack>
      </header>
      <div className="message-body">
        {loading
          ? <LoadingState text="Загрузка письма…" />
          : message.body?.html
            ? <iframe title={message.subject || 'Письмо'} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={prepareEmailHtml(message.body.html)} />
            : <pre>{message.body?.text || 'В письме нет текстового содержимого.'}</pre>}
      </div>
    </article>
  );
}
