import { Loader } from '@mantine/core';
import type { Message } from '../../../shared/api/client';
import { formatDate, formatSize, isSeen, tagLabel } from '../../../shared/lib/format';
import { EmptyState, LoadingState } from '../../../shared/ui/AsyncState';

export function MessageList({
  messages,
  selectedUid,
  loading,
  fetchingMore,
  hasMore,
  onOpen,
  onLoadMore,
}: {
  messages: Message[];
  selectedUid: number | null;
  loading: boolean;
  fetchingMore: boolean;
  hasMore: boolean;
  onOpen: (message: Message) => void;
  onLoadMore: () => void;
}) {
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
        : messages.map((message) => (
          <button
            key={`${message.mailbox}:${message.uid}`}
            className={`message-row ${selectedUid === message.uid ? 'selected' : ''} ${isSeen(message) ? '' : 'unread'}`}
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
            {(message.tags?.length ?? 0) > 0 && (
              <div className="message-tags">
                {message.tags.map((tag) => (
                  <span key={tag} className="message-tag">{tagLabel(tag)}</span>
                ))}
              </div>
            )}
            <span className="meta">{formatSize(message.size)}</span>
          </button>
        ))}
      {fetchingMore && <div className="list-loader"><Loader size="xs" />Загрузка старых писем…</div>}
    </section>
  );
}
