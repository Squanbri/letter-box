import { useEffect, useRef } from 'react';
import type { MailboxInfo, Message } from '../../../shared/api/client';
import { accountColor } from '../../../shared/lib/accountColor';
import { prepareEmailHtml } from '../../../shared/lib/email-html';
import { isSeen, mailboxDisplayName, tagLabel } from '../../../shared/lib/format';
import { tagBg, tagColor } from '../../../shared/lib/tagColor';
import { EmptyState, LoadingState } from '../../../shared/ui/AsyncState';

function AutoIframe({ srcDoc, title }: { srcDoc: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  const resize = () => {
    const frame = ref.current;
    if (!frame?.contentDocument?.body) return;
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
      style={{ width: '100%', border: 0, display: 'block', background: 'transparent' }}
    />
  );
}

export function MessageViewer({
  message,
  accountEmail,
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
  accountEmail?: string;
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
  if (!message) return <article className="message-view"><EmptyState text="Выберите письмо" /></article>;

  const archiveAvailable = mailboxes.some(
    (mailbox) => mailbox.specialUse === '\\Archive' && mailbox.path !== message.mailbox,
  );
  const trash = mailboxes.find((mailbox) => mailbox.specialUse === '\\Trash');
  const permanent = trash?.path === message.mailbox;
  const ancestors = thread.filter(
    (item) => !(item.mailbox === message.mailbox && item.uid === message.uid),
  );
  const flagged = message.flags.includes('\\Flagged');
  const color = accountColor(message.accountId);

  return (
    <article className="message-view">
      <div className="reader-action-strip">
        <div className="reader-action-tags">
          {message.tags.map((tag) => (
            <span
              key={tag}
              className="ai-tag"
              style={{ color: tagColor(tag), background: tagBg(tag) }}
            >
              {tagLabel(tag)}
            </span>
          ))}
          <span className="ai-badge">AI</span>
          <em>{new Date(message.date).toLocaleString('ru-RU', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}</em>
        </div>
        <div className="reader-action-buttons">
          <button type="button" className="reader-btn primary" disabled={loading} onClick={() => onReply(message)}>
            Ответить
          </button>
          <button type="button" className="reader-btn" disabled={loading} title="Переслать" onClick={() => onForward(message)}>
            ↪
          </button>
          <button
            type="button"
            className="reader-btn"
            disabled={flaggedPending || seenPending}
            title={flagged ? 'Снять важное' : 'Важное'}
            onClick={() => onFlagged(message, !flagged)}
          >
            {flagged ? '★' : '☆'}
          </button>
          {archiveAvailable && (
            <button type="button" className="reader-btn" disabled={pending} title="Архив" onClick={() => onArchive(message)}>
              □
            </button>
          )}
          <button
            type="button"
            className="reader-btn"
            disabled={pending}
            title={permanent ? 'Удалить навсегда' : 'В корзину'}
            onClick={() => onDelete(message, permanent)}
          >
            ⌫
          </button>
          <select
            className="reader-move"
            disabled={pending}
            defaultValue=""
            onChange={(event) => {
              const destination = event.currentTarget.value;
              if (destination) onMove(message, destination);
              event.currentTarget.value = '';
            }}
          >
            <option value="" disabled>Переместить…</option>
            {mailboxes
              .filter((mailbox) => mailbox.path !== message.mailbox)
              .map((mailbox) => (
                <option key={mailbox.path} value={mailbox.path}>
                  {mailboxDisplayName(mailbox)}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="reader-btn"
            disabled={seenPending || flaggedPending}
            onClick={() => onSeen(message, !isSeen(message))}
          >
            {isSeen(message) ? 'Непрочит.' : 'Прочит.'}
          </button>
        </div>
      </div>

      <div className="message-canvas">
        {(threadLoading || ancestors.length > 0) && (
          <section className="thread-spine" aria-label="Ветка диалога">
            {threadLoading ? (
              <p className="thread-spine-loading">Загрузка ветки…</p>
            ) : (
              ancestors.map((item, index) => {
                const last = index === ancestors.length - 1;
                return (
                  <button
                    type="button"
                    key={`${item.mailbox}:${item.uid}`}
                    className={last ? 'spine-row last' : 'spine-row'}
                    onClick={() => onOpenThreadMessage(item)}
                  >
                    <span className="spine-rail" aria-hidden>
                      <span className="spine-line" />
                      <span className="spine-node hollow" />
                    </span>
                    <span className="spine-from">
                      {item.from.name || item.from.address || 'Без отправителя'}
                    </span>
                    <span className="spine-preview">{item.subject || 'Без темы'}</span>
                    <time className="spine-time">
                      {new Date(item.date).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </button>
                );
              })
            )}
          </section>
        )}

        <div className="reader-current">
          <div className="spine-rail current-rail" aria-hidden>
            <span className="spine-line short" />
            <span className="spine-node filled" />
          </div>
          <div className="reader-current-body">
            <h1>{message.subject || 'Без темы'}</h1>
            <div className="reader-meta">
              <strong>{message.from.name || message.from.address}</strong>
              <span className="mono">{message.from.address}</span>
              <time className="mono">{new Date(message.date).toLocaleString('ru-RU')}</time>
              <span className="reader-account mono">
                <span className="account-dot" style={{ background: color.accent }} />
                {accountEmail ?? message.accountId}
              </span>
            </div>
            <div className="message-body">
              {loading
                ? <LoadingState text="Загрузка письма…" />
                : message.body?.html
                  ? <AutoIframe title={message.subject || 'Письмо'} srcDoc={prepareEmailHtml(message.body.html)} />
                  : <pre>{message.body?.text || 'Пустое письмо'}</pre>}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
