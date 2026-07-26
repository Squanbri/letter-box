import { useCallback, useEffect, useState } from 'react';
import { api, type AccountInput, type AccountStatus, type Message } from './api';

const TABS_KEY = 'letter-box.open-account-tabs';
const ACTIVE_KEY = 'letter-box.active-tab';

export function App() {
  const [accounts, setAccounts] = useState<AccountStatus[] | null>(null);
  const [tabs, setTabs] = useState<string[]>(readTabs);
  const [active, setActive] = useState<string>(() => localStorage.getItem(ACTIVE_KEY) ?? 'overview');
  const [editing, setEditing] = useState<AccountStatus | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [syncVersions, setSyncVersions] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    try {
      const next = await api.accounts();
      setAccounts(next);
      setTabs((current) => current.filter((id) => next.some((account) => account.id === id)));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { localStorage.setItem(TABS_KEY, JSON.stringify(tabs)); }, [tabs]);
  useEffect(() => { localStorage.setItem(ACTIVE_KEY, active); }, [active]);
  useEffect(() => {
    if (active !== 'overview' && accounts && !accounts.some((item) => item.id === active)) {
      setActive('overview');
    } else if (active !== 'overview' && accounts?.some((item) => item.id === active)) {
      setTabs((current) => current.includes(active) ? current : [...current, active]);
    }
  }, [accounts, active]);

  const openAccount = (id: string) => {
    setTabs((current) => current.includes(id) ? current : [...current, id]);
    setActive(id);
  };
  const closeTab = (id: string) => {
    setTabs((current) => current.filter((item) => item !== id));
    if (active === id) setActive('overview');
  };
  const syncAccount = useCallback(async (id: string) => {
    setSyncingIds((current) => new Set(current).add(id));
    setAccounts((current) => current?.map((account) =>
      account.id === id ? { ...account, status: 'syncing' } : account,
    ) ?? null);
    try {
      await api.sync(id);
      setSyncVersions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    } finally {
      setSyncingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      await refresh();
    }
  }, [refresh]);
  const syncAll = async () => {
    const ids = accounts?.map((account) => account.id) ?? [];
    const results = await Promise.allSettled(ids.map(syncAccount));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      setError(`Не удалось синхронизировать аккаунтов: ${failures.length}`);
    }
  };

  if (!accounts) {
    return <AppStatus error={Boolean(error)} detail={error ?? 'Загрузка аккаунтов…'} retry={refresh} />;
  }

  return (
    <main className="app-shell">
      <nav className="tabbar">
        <button className={active === 'overview' ? 'tab active' : 'tab'} onClick={() => setActive('overview')}>
          Обзор
        </button>
        {tabs.map((id) => {
          const account = accounts.find((item) => item.id === id);
          if (!account) return null;
          return (
            <div className={active === id ? 'tab active' : 'tab'} key={id}>
              <button onClick={() => setActive(id)}>{account.email}</button>
              <button className="tab-close" title="Закрыть вкладку" onClick={() => closeTab(id)}>×</button>
            </div>
          );
        })}
      </nav>
      {error && <div className="error-banner">{error}</div>}
      <div className={active === 'overview' ? 'tab-panel active' : 'tab-panel'}>
        <Overview
          accounts={accounts}
          onAdd={() => setEditing('new')}
          onOpen={openAccount}
          onReconnect={setEditing}
          syncingIds={syncingIds}
          onSyncAll={() => void syncAll()}
          onDelete={async (account) => {
            if (!window.confirm(`Удалить аккаунт ${account.email} и все его локальные данные?`)) return;
            try {
              await api.deleteAccount(account.id);
              closeTab(account.id);
              await refresh();
            } catch (reason) { setError(errorMessage(reason)); }
          }}
        />
      </div>
      {tabs.map((id) => {
        const account = accounts.find((item) => item.id === id);
        return account ? (
          <div className={active === id ? 'tab-panel active' : 'tab-panel'} key={id}>
            <Mailbox
              account={account}
              syncing={syncingIds.has(account.id)}
              syncVersion={syncVersions[account.id] ?? 0}
              onSync={() => syncAccount(account.id)}
            />
          </div>
        ) : null;
      })}
      {editing && (
        <AccountDialog
          current={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (account) => {
            setEditing(null);
            await refresh();
            openAccount(account.id);
          }}
        />
      )}
    </main>
  );
}

function Overview({
  accounts, syncingIds, onAdd, onOpen, onReconnect, onDelete, onSyncAll,
}: {
  accounts: AccountStatus[];
  syncingIds: Set<string>;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onReconnect: (account: AccountStatus) => void;
  onDelete: (account: AccountStatus) => void;
  onSyncAll: () => void;
}) {
  return (
    <section className="overview">
      <header className="page-header">
        <div><h1>Обзор</h1><span>{accounts.length} подключённых аккаунтов</span></div>
        <div className="page-actions">
          <button className="secondary" onClick={onSyncAll} disabled={accounts.length === 0 || syncingIds.size > 0}>
            {syncingIds.size > 0 && <Spinner />}
            {syncingIds.size > 0 ? `Обновление ${syncingIds.size}…` : 'Обновить все'}
          </button>
          <button onClick={onAdd}>Добавить аккаунт</button>
        </div>
      </header>
      <div className="account-grid">
        {accounts.map((account) => (
          <article className="overview-account" key={account.id}>
            <button className="account-main" onClick={() => onOpen(account.id)}>
              <span className={`status-dot ${account.status}`} />
              <span><strong>{account.email}</strong><small>{providerName(account.provider)}</small></span>
              <span className="status-label">{statusName(account.status)}</span>
            </button>
            {account.lastError && <p>{account.lastError}</p>}
            <footer>
              <small>{account.lastSyncAt ? `Обновлено ${formatDate(account.lastSyncAt)}` : 'Ещё не синхронизирован'}</small>
              <div>
                <button className="secondary" onClick={() => onReconnect(account)}>Переподключить</button>
                <button className="danger" onClick={() => onDelete(account)}>Удалить</button>
              </div>
            </footer>
          </article>
        ))}
        {accounts.length === 0 && (
          <div className="empty-overview"><strong>Подключите первую почту</strong><span>Mail.ru и Яндекс поддерживают несколько аккаунтов.</span></div>
        )}
      </div>
    </section>
  );
}

function Mailbox({ account, syncing, syncVersion, onSync }: {
  account: AccountStatus;
  syncing: boolean;
  syncVersion: number;
  onSync: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingUid, setOpeningUid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setMessages(await api.messages(account.id)); setError(null); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  }, [account.id]);
  useEffect(() => { setSelected(null); }, [account.id]);
  useEffect(() => { setLoading(true); void load(); }, [load, syncVersion]);
  const sync = async () => {
    setError(null);
    try { await onSync(); }
    catch (reason) { setError(errorMessage(reason)); }
  };
  const openMessage = async (message: Message) => {
    setSelected(message); setOpeningUid(message.uid);
    try { setSelected(await api.message(account.id, message.uid, message.mailbox)); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setOpeningUid(null); }
  };
  return (
    <section className="mail-page">
      <header className="page-header">
        <div><h1>Входящие</h1><span>{account.email}</span></div>
        <button onClick={() => void sync()} disabled={syncing}>
          {syncing && <Spinner />}
          {syncing ? 'Синхронизация…' : 'Обновить'}
        </button>
      </header>
      {error && <div className="error-banner">{error}</div>}
      <div className="mail-layout">
        <section className="message-list">
          {messages.length === 0 ? (
            loading ? <LoadingState text="Загрузка писем…" /> : <Empty text="Писем пока нет" />
          ) :
            messages.map((message) => (
              <button key={`${message.mailbox}:${message.uid}`} className={`message-row ${selected?.uid === message.uid ? 'selected' : ''}`} onClick={() => void openMessage(message)}>
                <div className="message-heading"><strong>{message.from.name || message.from.address || 'Неизвестный отправитель'}</strong><time>{formatDate(message.date)}</time></div>
                <span className="subject">{message.subject || 'Без темы'}</span><span className="meta">{formatSize(message.size)}</span>
              </button>
            ))}
        </section>
        <article className="message-view">
          {!selected ? <Empty text="Выберите письмо" /> : <>
            <header className="message-header"><h2>{selected.subject || 'Без темы'}</h2><div><strong>{selected.from.name || selected.from.address}</strong><span>{selected.from.address}</span><time>{new Date(selected.date).toLocaleString('ru-RU')}</time></div></header>
            <div className="message-body">{openingUid === selected.uid ? <LoadingState text="Загрузка письма…" /> : selected.body?.html ? <iframe title={selected.subject || 'Письмо'} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={prepareEmailHtml(selected.body.html)} /> : <pre>{selected.body?.text || 'В письме нет текстового содержимого.'}</pre>}</div>
          </>}
        </article>
      </div>
    </section>
  );
}

function AccountDialog({ current, onClose, onSaved }: {
  current: AccountStatus | null;
  onClose: () => void;
  onSaved: (account: AccountStatus) => Promise<void>;
}) {
  const [form, setForm] = useState<AccountInput>({ provider: current?.provider ?? 'mailru', email: current?.email ?? '', password: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const saved = current ? await api.reconnectAccount(current.id, form) : await api.addAccount(form);
      await onSaved(saved);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  };
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form className="account-card" onSubmit={(event) => void submit(event)} onMouseDown={(event) => event.stopPropagation()}>
        <div><span className="eyebrow">{current ? 'Переподключение' : 'Новый аккаунт'}</span><h2>Подключение к почте</h2><p>Используйте отдельный пароль приложения. Он будет зашифрован системными средствами macOS.</p></div>
        <fieldset><legend>Почтовый сервис</legend>{(['mailru', 'yandex'] as const).map((provider) => <label key={provider} className={form.provider === provider ? 'provider selected' : 'provider'}><input type="radio" checked={form.provider === provider} onChange={() => setForm({ ...form, provider })} />{providerName(provider)}</label>)}</fieldset>
        <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
        <label className="field"><span>Пароль приложения</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Отмена</button><button disabled={saving}>{saving && <Spinner />}{saving ? 'Проверка…' : current ? 'Переподключить' : 'Добавить'}</button></div>
      </form>
    </div>
  );
}

function Empty({ text }: { text: string }) { return <div className="empty-state"><strong>{text}</strong></div>; }
function Spinner() { return <span className="spinner" aria-hidden="true" />; }
function LoadingState({ text }: { text: string }) { return <div className="loading-state"><Spinner /><strong>{text}</strong></div>; }
function AppStatus({ detail, error, retry }: { detail: string; error: boolean; retry: () => Promise<void> }) {
  return <main className="full-status"><div className="status-mark">✉</div><h1>Letter Box</h1><p className={error ? 'status-error' : ''}>{detail}</p>{error ? <button onClick={() => void retry()}>Повторить</button> : <div className="status-spinner" />}</main>;
}
function readTabs(): string[] { try { const value = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; } }
function providerName(provider: AccountStatus['provider']) { return provider === 'mailru' ? 'Mail.ru' : 'Яндекс'; }
function statusName(status: AccountStatus['status']) { return status === 'connected' ? 'Подключён' : status === 'syncing' ? 'Синхронизация…' : status === 'error' ? 'Требует внимания' : 'Не проверен'; }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : 'Произошла неизвестная ошибка'; }
function formatDate(value: string) { const date = new Date(value); return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }); }
function formatSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`; }
function prepareEmailHtml(html: string) { const base = '<base target="_blank">'; const head = html.match(/<head(?:\s[^>]*)?>/i); if (head?.index !== undefined) { const at = head.index + head[0].length; return `${html.slice(0, at)}${base}${html.slice(at)}`; } return `${base}${html}`; }
