import { useCallback, useEffect, useState } from 'react';
import { api, type Message } from './api';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [openingUid, setOpeningUid] = useState<number | null>(null);

  const loadLocalMessages = useCallback(async () => {
    try {
      const localMessages = await api.messages();
      setMessages(localMessages);
      setStatus('ready');
      setError(null);
    } catch (reason) {
      setStatus('error');
      setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => {
    void loadLocalMessages();
  }, [loadLocalMessages]);

  const sync = async () => {
    setStatus('loading');
    setError(null);
    try {
      await api.connect();
      await api.sync();
      const syncedMessages = await api.messages();
      setMessages(syncedMessages);
      setStatus('ready');
      if (selected) {
        setSelected(syncedMessages.find((message) => message.uid === selected.uid) ?? null);
      }
    } catch (reason) {
      setStatus('error');
      setError(errorMessage(reason));
    }
  };

  const openMessage = async (message: Message) => {
    setSelected(message);
    setOpeningUid(message.uid);
    setError(null);
    try {
      setSelected(await api.message(message.uid));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setOpeningUid(null);
    }
  };

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div>
          <h1>Входящие</h1>
          <span>{messages.length} писем</span>
        </div>
        <button type="button" onClick={() => void sync()} disabled={status === 'loading'}>
          {status === 'loading' ? 'Синхронизация…' : 'Обновить'}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="mail-layout">
        <section className="message-list" aria-label="Список писем">
          {messages.length === 0 && status !== 'error' ? (
            <div className="empty-state">
              <strong>Писем пока нет</strong>
              <span>Настройте .env и нажмите «Обновить»</span>
            </div>
          ) : (
            messages.map((message) => (
              <button
                type="button"
                key={message.uid}
                className={`message-row ${selected?.uid === message.uid ? 'selected' : ''}`}
                onClick={() => void openMessage(message)}
              >
                <div className="message-heading">
                  <strong>{message.from.name || message.from.address || 'Неизвестный отправитель'}</strong>
                  <time>{formatDate(message.date)}</time>
                </div>
                <span className="subject">{message.subject || 'Без темы'}</span>
                <span className="meta">{formatSize(message.size)}</span>
              </button>
            ))
          )}
        </section>

        <article className="message-view">
          {!selected ? (
            <div className="empty-state">
              <strong>Выберите письмо</strong>
              <span>Тело будет загружено с IMAP при первом открытии</span>
            </div>
          ) : (
            <>
              <header className="message-header">
                <h2>{selected.subject || 'Без темы'}</h2>
                <div>
                  <strong>{selected.from.name || selected.from.address || 'Неизвестный отправитель'}</strong>
                  {selected.from.name && selected.from.address && <span>{selected.from.address}</span>}
                  <time>{new Date(selected.date).toLocaleString('ru-RU')}</time>
                </div>
              </header>
              <div className="message-body">
                {openingUid === selected.uid ? (
                  <div className="loading">Загрузка письма…</div>
                ) : selected.body?.html ? (
                  <iframe
                    title={selected.subject || 'Письмо'}
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    srcDoc={prepareEmailHtml(selected.body.html)}
                  />
                ) : (
                  <pre>{selected.body?.text || 'В письме нет текстового содержимого.'}</pre>
                )}
              </div>
            </>
          )}
        </article>
      </div>
    </main>
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Произошла неизвестная ошибка';
}

function formatDate(value: string): string {
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function prepareEmailHtml(html: string): string {
  const base = '<base target="_blank">';
  const head = html.match(/<head(?:\s[^>]*)?>/i);

  if (head?.index !== undefined) {
    const insertAt = head.index + head[0].length;
    return `${html.slice(0, insertAt)}${base}${html.slice(insertAt)}`;
  }

  return `${base}${html}`;
}
