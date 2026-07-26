import { useCallback, useEffect, useState } from 'react';
import { api, type AccountStatus, type Message } from './api';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [openingUid, setOpeningUid] = useState<number | null>(null);
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [showAccountSetup, setShowAccountSetup] = useState(false);

  const loadLocalMessages = useCallback(async () => {
    try {
      const [accountStatus, localMessages] = await Promise.all([
        api.account(),
        api.messages(),
      ]);
      setAccount(accountStatus);
      setShowAccountSetup(!accountStatus.configured);
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

  if (!account && status === 'loading') {
    return <AppStatus title="Загрузка почты…" detail="Читаем локальную базу данных" />;
  }

  if (!account && status === 'error') {
    return (
      <AppStatus
        title="Не удалось подключиться к локальному сервису"
        detail={error ?? 'Неизвестная ошибка'}
        error
        action={
          <button type="button" onClick={() => void loadLocalMessages()}>
            Повторить
          </button>
        }
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div>
          <h1>Входящие</h1>
          <span>{account?.email ?? `${messages.length} писем`}</span>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => setShowAccountSetup(true)}
          >
            Аккаунт
          </button>
          <button
            type="button"
            onClick={() => void sync()}
            disabled={status === 'loading' || !account?.configured}
          >
            {status === 'loading' ? 'Синхронизация…' : 'Обновить'}
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {showAccountSetup ? (
        <AccountSetup
          current={account}
          onCancel={account?.configured ? () => setShowAccountSetup(false) : undefined}
          onSaved={async (savedAccount) => {
            setAccount(savedAccount);
            setShowAccountSetup(false);
            setStatus('loading');
            await api.sync();
            await loadLocalMessages();
          }}
        />
      ) : <div className="mail-layout">
        <section className="message-list" aria-label="Список писем">
          {messages.length === 0 && status !== 'error' ? (
            <div className="empty-state">
              <strong>Писем пока нет</strong>
              <span>Нажмите «Обновить», чтобы синхронизировать INBOX</span>
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
      </div>}
    </main>
  );
}

function AppStatus({
  title,
  detail,
  error = false,
  action,
}: {
  title: string;
  detail: string;
  error?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <main className="full-status">
      <div className="status-mark">✉</div>
      <h1>{title}</h1>
      <p className={error ? 'status-error' : ''}>{detail}</p>
      {!error && <div className="status-spinner" />}
      {action}
      {error && (
        <small>
          Подробности: ~/Library/Application Support/Letter Box/logs/main.log
        </small>
      )}
    </main>
  );
}

function AccountSetup({
  current,
  onCancel,
  onSaved,
}: {
  current: AccountStatus | null;
  onCancel?: () => void;
  onSaved: (account: AccountStatus) => Promise<void>;
}) {
  const [provider, setProvider] = useState<'mailru' | 'yandex'>(
    current?.provider ?? 'mailru',
  );
  const [email, setEmail] = useState(current?.email ?? '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const saved = await api.saveAccount({ provider, email, password });
      await onSaved(saved);
    } catch (reason) {
      setFormError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="account-screen">
      <form className="account-card" onSubmit={(event) => void submit(event)}>
        <div>
          <span className="eyebrow">Один почтовый аккаунт</span>
          <h2>Подключение к почте</h2>
          <p>
            Используйте пароль приложения. Обычный пароль от почты не подойдёт.
            Пароль будет зашифрован средствами macOS Keychain.
          </p>
        </div>

        <fieldset>
          <legend>Почтовый сервис</legend>
          <label className={provider === 'mailru' ? 'provider selected' : 'provider'}>
            <input
              type="radio"
              name="provider"
              value="mailru"
              checked={provider === 'mailru'}
              onChange={() => setProvider('mailru')}
            />
            Mail.ru
          </label>
          <label className={provider === 'yandex' ? 'provider selected' : 'provider'}>
            <input
              type="radio"
              name="provider"
              value="yandex"
              checked={provider === 'yandex'}
              onChange={() => setProvider('yandex')}
            />
            Яндекс
          </label>
        </fieldset>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="field">
          <span>Пароль приложения</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          {provider === 'yandex' && (
            <small className="field-hint">
              В Яндекс Почте должен быть разрешён IMAP. Новый пароль приложения
              типа «Почта» может активироваться не сразу.
            </small>
          )}
        </label>

        {formError && <div className="form-error">{formError}</div>}

        <div className="form-actions">
          {onCancel && (
            <button type="button" className="secondary" onClick={onCancel}>
              Отмена
            </button>
          )}
          <button type="submit" disabled={saving}>
            {saving ? 'Проверка подключения…' : 'Подключить'}
          </button>
        </div>
      </form>
    </section>
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
