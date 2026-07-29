import type { CSSProperties } from 'react';
import { Loader } from '@mantine/core';
import type { Message } from '../../../shared/api/client';
import { accountColor } from '../../../shared/lib/accountColor';
import { formatDate, formatSize, isSeen, tagLabel } from '../../../shared/lib/format';
import { EmptyState, LoadingState } from '../../../shared/ui/AsyncState';

export function MessageList({
  messages,
  selectedUid,
  selectedKey,
  accountLabels,
  loading,
  fetchingMore,
  hasMore,
  onOpen,
  onLoadMore,
}: {
  messages: Message[];
  selectedUid: number | null;
  selectedKey?: string | null;
  accountLabels?: Map<string, string>;
  loading: boolean;
  fetchingMore: boolean;
  hasMore: boolean;
  onOpen: (message: Message) => void;
  onLoadMore: () => void;
}) {
  const showAccountColors = Boolean(accountLabels?.size);

  return (
    <section
      className="message-list"
      onScroll={(event) => {
        const element = event.currentTarget;
        if (
          hasMore
          && element.scrollHeight - element.scrollTop - element.clientHeight < 180
        ) onLoadMore();
      }}
    >
      {!messages.length
        ? loading
          ? <LoadingState text="Загрузка писем…" />
          : <EmptyState text="Писем пока нет" />
        : messages.map((message) => {
          const key = `${message.accountId}:${message.mailbox}:${message.uid}`;
          const selected = selectedKey
            ? selectedKey === key
            : selectedUid === message.uid;
          const accountLabel = accountLabels?.get(message.accountId);
          const color = showAccountColors ? accountColor(message.accountId) : null;
          const rowStyle = color
            ? {
              '--account-accent': color.accent,
              '--account-bg': color.bg,
              '--account-fg': color.fg,
            } as CSSProperties
            : undefined;
          return (
            <button
              key={key}
              className={[
                'message-row',
                selected ? 'selected' : '',
                isSeen(message) ? '' : 'unread',
                color ? 'has-account-color' : '',
              ].filter(Boolean).join(' ')}
              style={rowStyle}
              onClick={() => onOpen(message)}
            >
              <div className="message-heading">
                <span className="message-sender">
                  {!isSeen(message) && <span className="unread-dot" aria-label="Непрочитанное письмо" />}
                  <strong>{message.from.name || message.from.address || 'Неизвестный отправитель'}</strong>
                </span>
                <time>{formatDate(message.date)}</time>
              </div>
              <span className="subject">{message.flags.includes('\\Flagged') ? '★ ' : ''}{message.subject || 'Без темы'}</span>
              {message.body?.text && (
                <span className="message-snippet">{message.body.text.trim().replace(/\s+/g, ' ')}</span>
              )}
              {(accountLabel || (message.tags?.length ?? 0) > 0) && (
                <div className="message-tags">
                  {accountLabel && <span className="message-account">{accountLabel}</span>}
                  {message.tags.map((tag) => (
                    <span key={tag} className="message-tag">{tagLabel(tag)}</span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      {fetchingMore && <div className="list-loader"><Loader size="xs" />Загрузка старых писем…</div>}
    </section>
  );
}
