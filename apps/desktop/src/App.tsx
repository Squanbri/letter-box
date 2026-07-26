import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type AccountInput,
  type AccountStatus,
  type MailboxInfo,
  type Message,
  type SyncResult,
} from './api';

const TABS_KEY = 'letter-box.open-account-tabs';
const ACTIVE_KEY = 'letter-box.active-tab';
const BACKGROUND_SYNC_KEY = 'letter-box.background-sync';

interface BackgroundSyncSettings {
  intervalMinutes: number;
  disabledAccountIds: string[];
  notifications: boolean;
}

export function App() {
  const [accounts, setAccounts] = useState<AccountStatus[] | null>(null);
  const [tabs, setTabs] = useState<string[]>(readTabs);
  const [active, setActive] = useState<string>(() => localStorage.getItem(ACTIVE_KEY) ?? 'overview');
  const [editing, setEditing] = useState<AccountStatus | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [syncVersions, setSyncVersions] = useState<Record<string, number>>({});
  const [backgroundSync, setBackgroundSync] = useState<BackgroundSyncSettings>(
    readBackgroundSyncSettings,
  );
  const syncPromises = useRef(new Map<string, Promise<SyncResult>>());
  const accountsRef = useRef<AccountStatus[]>([]);
  const backgroundSyncRef = useRef(backgroundSync);

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
    localStorage.setItem(BACKGROUND_SYNC_KEY, JSON.stringify(backgroundSync));
    backgroundSyncRef.current = backgroundSync;
  }, [backgroundSync]);
  useEffect(() => { accountsRef.current = accounts ?? []; }, [accounts]);
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
  const syncAccount = useCallback((id: string, notificationEmail?: string) => {
    const running = syncPromises.current.get(id);
    if (running) return running;
    const task = (async () => {
      setSyncingIds((current) => new Set(current).add(id));
      setAccounts((current) => current?.map((account) =>
        account.id === id ? { ...account, status: 'syncing' } : account,
      ) ?? null);
      try {
        const result = await api.sync(id);
        setSyncVersions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
        if (notificationEmail && result.added > 0) {
          showNewMailNotification(notificationEmail, result.added);
        }
        return result;
      } finally {
        syncPromises.current.delete(id);
        setSyncingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        await refresh();
      }
    })();
    syncPromises.current.set(id, task);
    return task;
  }, [refresh]);
  const syncAll = async () => {
    const ids = accounts?.map((account) => account.id) ?? [];
    const results = await Promise.allSettled(ids.map((id) => syncAccount(id)));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      setError(`Не удалось синхронизировать аккаунтов: ${failures.length}`);
    }
  };
  const backgroundSyncAll = useCallback(() => {
    if (!navigator.onLine) return;
    const settings = backgroundSyncRef.current;
    for (const account of accountsRef.current) {
      if (!settings.disabledAccountIds.includes(account.id)) {
        void syncAccount(
          account.id,
          settings.notifications && account.lastSyncAt ? account.email : undefined,
        ).catch(() => undefined);
      }
    }
  }, [syncAccount]);

  useEffect(() => {
    const initial = window.setTimeout(backgroundSyncAll, 10_000);
    const interval = window.setInterval(
      backgroundSyncAll,
      backgroundSync.intervalMinutes * 60_000,
    );
    window.addEventListener('online', backgroundSyncAll);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener('online', backgroundSyncAll);
    };
  }, [backgroundSyncAll, backgroundSync.intervalMinutes]);

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
              {account.unreadCount > 0 && <span className="unread-badge">{formatCount(account.unreadCount)}</span>}
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
          backgroundSync={backgroundSync}
          onBackgroundSyncChange={setBackgroundSync}
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
              onSync={(mailbox) => mailbox === 'INBOX'
                ? syncAccount(account.id)
                : api.sync(account.id, mailbox).finally(refresh)}
              onAccountChanged={refresh}
              onUnreadChange={(delta) => setAccounts((current) =>
                current?.map((item) => item.id === account.id
                  ? { ...item, unreadCount: Math.max(0, item.unreadCount + delta) }
                  : item) ?? null,
              )}
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
  accounts,
  syncingIds,
  backgroundSync,
  onBackgroundSyncChange,
  onAdd,
  onOpen,
  onReconnect,
  onDelete,
  onSyncAll,
}: {
  accounts: AccountStatus[];
  syncingIds: Set<string>;
  backgroundSync: BackgroundSyncSettings;
  onBackgroundSyncChange: (settings: BackgroundSyncSettings) => void;
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
      <div className="sync-settings">
        <span>Фоновая синхронизация</span>
        <label>
          Интервал
          <select
            value={backgroundSync.intervalMinutes}
            onChange={(event) => onBackgroundSyncChange({
              ...backgroundSync,
              intervalMinutes: Number(event.target.value),
            })}
          >
            <option value={5}>5 минут</option>
            <option value={15}>15 минут</option>
            <option value={30}>30 минут</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={backgroundSync.notifications}
            onChange={(event) => void changeNotificationSetting(
              event.target.checked,
              backgroundSync,
              onBackgroundSyncChange,
            )}
          />
          Уведомления о новых письмах
        </label>
      </div>
      <div className="account-grid">
        {accounts.map((account) => (
          <article className="overview-account" key={account.id}>
            <button className="account-main" onClick={() => onOpen(account.id)}>
              <span className={`status-dot ${account.status}`} />
              <span><strong>{account.email}</strong><small>{providerName(account.provider)}</small></span>
              <span className="account-summary">
                {account.unreadCount > 0 && <strong>{account.unreadCount} непрочитанных</strong>}
                <span className="status-label">{statusName(account.status)}</span>
              </span>
            </button>
            {account.lastError && <p>{account.lastError}</p>}
            <footer>
              <label className="auto-sync-toggle">
                <input
                  type="checkbox"
                  checked={!backgroundSync.disabledAccountIds.includes(account.id)}
                  onChange={(event) => onBackgroundSyncChange({
                    ...backgroundSync,
                    disabledAccountIds: event.target.checked
                      ? backgroundSync.disabledAccountIds.filter((id) => id !== account.id)
                      : [...backgroundSync.disabledAccountIds, account.id],
                  })}
                />
                Автообновление
              </label>
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

function Mailbox({
  account,
  syncing,
  syncVersion,
  onSync,
  onAccountChanged,
  onUnreadChange,
}: {
  account: AccountStatus;
  syncing: boolean;
  syncVersion: number;
  onSync: (mailbox: string) => Promise<unknown>;
  onAccountChanged: () => Promise<void>;
  onUnreadChange: (delta: number) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxInfo[]>([
    {
      path: 'INBOX', name: 'Входящие', delimiter: '/', specialUse: '\\Inbox',
      totalCount: 0, unreadCount: 0,
    },
  ]);
  const [selectedMailbox, setSelectedMailbox] = useState(
    () => localStorage.getItem(`letter-box.mailbox.${account.id}`) ?? 'INBOX',
  );
  const [selected, setSelected] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const [folderSyncing, setFolderSyncing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [openingUid, setOpeningUid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onSyncRef = useRef(onSync);
  useEffect(() => { onSyncRef.current = onSync; }, [onSync]);
  const load = useCallback(async () => {
    try {
      const page = await api.messages(account.id, selectedMailbox);
      setMessages(page);
      setHasMore(page.length === 50);
      setError(null);
    }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  }, [account.id, selectedMailbox]);
  useEffect(() => { setSelected(null); }, [account.id]);
  useEffect(() => { setLoading(true); void load(); }, [load, syncVersion]);
  useEffect(() => {
    let active = true;
    setFolderSyncing(true);
    void onSyncRef.current(selectedMailbox)
      .then(() => active ? load() : undefined)
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setFolderSyncing(false);
      });
    return () => { active = false; };
  }, [account.id, selectedMailbox, load]);
  useEffect(() => {
    localStorage.setItem(`letter-box.mailbox.${account.id}`, selectedMailbox);
    setSelected(null);
    setMessages([]);
    setHasMore(true);
  }, [account.id, selectedMailbox]);
  useEffect(() => {
    let active = true;
    void api.mailboxes(account.id).then((stored) => {
      if (active) setMailboxes(stored);
    });
    void api.syncMailboxes(account.id).then((synced) => {
      if (active) setMailboxes(synced);
    }).catch((reason) => {
      if (active) setError(errorMessage(reason));
    });
    return () => { active = false; };
  }, [account.id]);
  useEffect(() => {
    if (!mailboxes.some((mailbox) => mailbox.path === selectedMailbox)) {
      setSelectedMailbox(mailboxes.find((mailbox) => mailbox.specialUse === '\\Inbox')?.path ?? mailboxes[0]?.path ?? 'INBOX');
    }
  }, [mailboxes, selectedMailbox]);
  const sync = async () => {
    setFolderSyncing(true); setError(null);
    try { await onSync(selectedMailbox); await load(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setFolderSyncing(false); }
  };
  const loadMore = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      let page = await api.messages(
        account.id,
        selectedMailbox,
        messages.length,
      );
      if (page.length === 0) {
        const beforeUid = Math.min(...messages.map((message) => message.uid));
        const result = await api.loadOlder(account.id, selectedMailbox, beforeUid);
        if (result.loaded === 0) {
          setHasMore(false);
          return;
        }
        page = await api.messages(
          account.id,
          selectedMailbox,
          messages.length,
        );
      }
      setMessages((current) => [
        ...current,
        ...page.filter((next) => !current.some(
          (item) => item.uid === next.uid && item.mailbox === next.mailbox,
        )),
      ]);
      if (page.length < 50) {
        const total = mailboxes.find((mailbox) => mailbox.path === selectedMailbox)?.totalCount;
        if (total === undefined || messages.length + page.length >= total) setHasMore(false);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingMore(false);
    }
  };
  const openMessage = async (message: Message) => {
    setSelected(message); setOpeningUid(message.uid);
    try {
      if (!isSeen(message)) await changeSeen(message, true);
      setSelected(await api.message(account.id, message.uid, message.mailbox));
    }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setOpeningUid(null); }
  };
  const currentFolderSyncing = folderSyncing
    || (selectedMailbox === 'INBOX' && syncing);
  const changeSeen = async (message: Message, seen: boolean) => {
    const previousFlags = message.flags;
    const nextFlags = withSeen(previousFlags, seen);
    const applyFlags = (item: Message) =>
      item.uid === message.uid && item.mailbox === message.mailbox
        ? { ...item, flags: nextFlags }
        : item;
    setMessages((current) => current.map(applyFlags));
    setSelected((current) => current ? applyFlags(current) : current);
    if (message.mailbox === 'INBOX') onUnreadChange(seen ? -1 : 1);
    try {
      const updated = await api.setSeen(account.id, message.uid, seen, message.mailbox);
      setMessages((current) => current.map((item) =>
        item.uid === updated.uid && item.mailbox === updated.mailbox
          ? { ...item, flags: updated.flags }
          : item,
      ));
      setSelected((current) =>
        current?.uid === updated.uid && current.mailbox === updated.mailbox
          ? { ...current, flags: updated.flags }
          : current,
      );
      await onAccountChanged();
    } catch (reason) {
      const rollback = (item: Message) =>
        item.uid === message.uid && item.mailbox === message.mailbox
          ? { ...item, flags: previousFlags }
          : item;
      setMessages((current) => current.map(rollback));
      setSelected((current) => current ? rollback(current) : current);
      if (message.mailbox === 'INBOX') onUnreadChange(seen ? 1 : -1);
      setError(errorMessage(reason));
    }
  };
  return (
    <section className="mail-page">
      <header className="page-header">
        <div><h1>{mailboxTitle(mailboxes, selectedMailbox)}</h1><span>{account.email}</span></div>
        <button onClick={() => void sync()} disabled={currentFolderSyncing}>
          {currentFolderSyncing && <Spinner />}
          {currentFolderSyncing ? 'Синхронизация…' : 'Обновить'}
        </button>
      </header>
      {error && <div className="error-banner">{error}</div>}
      <div className="mail-layout">
        <aside className="mailbox-list" aria-label="Почтовые папки">
          {mailboxes.map((mailbox) => (
            <button
              key={mailbox.path}
              className={selectedMailbox === mailbox.path ? 'selected' : ''}
              onClick={() => setSelectedMailbox(mailbox.path)}
              title={mailbox.path}
            >
              <span>{mailboxIcon(mailbox.specialUse)}</span>
              <strong>{mailboxDisplayName(mailbox)}</strong>
              {mailbox.unreadCount > 0 && <small>{formatCount(mailbox.unreadCount)}</small>}
            </button>
          ))}
        </aside>
        <section
          className="message-list"
          onScroll={(event) => {
            const element = event.currentTarget;
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 180) {
              void loadMore();
            }
          }}
        >
          {messages.length === 0 ? (
            loading || currentFolderSyncing
              ? <LoadingState text="Загрузка писем…" />
              : <Empty text="Писем пока нет" />
          ) :
            messages.map((message) => (
              <button key={`${message.mailbox}:${message.uid}`} className={`message-row ${selected?.uid === message.uid ? 'selected' : ''} ${isSeen(message) ? '' : 'unread'}`} onClick={() => void openMessage(message)}>
                <div className="message-heading"><strong>{message.from.name || message.from.address || 'Неизвестный отправитель'}</strong><time>{formatDate(message.date)}</time></div>
                <span className="subject">{message.subject || 'Без темы'}</span><span className="meta">{formatSize(message.size)}</span>
              </button>
            ))}
          {loadingMore && <div className="list-loader"><Spinner />Загрузка старых писем…</div>}
        </section>
        <article className="message-view">
          {!selected ? <Empty text="Выберите письмо" /> : <>
            <header className="message-header">
              <div className="message-title">
                <h2>{selected.subject || 'Без темы'}</h2>
                <button className="secondary compact" onClick={() => void changeSeen(selected, !isSeen(selected))}>
                  {isSeen(selected) ? 'Сделать непрочитанным' : 'Сделать прочитанным'}
                </button>
              </div>
              <div className="sender-details"><strong>{selected.from.name || selected.from.address}</strong><span>{selected.from.address}</span><time>{new Date(selected.date).toLocaleString('ru-RU')}</time></div>
            </header>
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
function readBackgroundSyncSettings(): BackgroundSyncSettings {
  const fallback: BackgroundSyncSettings = {
    intervalMinutes: 5,
    disabledAccountIds: [],
    notifications: false,
  };
  try {
    const value = JSON.parse(localStorage.getItem(BACKGROUND_SYNC_KEY) ?? '{}') as Partial<BackgroundSyncSettings>;
    return {
      intervalMinutes: [5, 15, 30].includes(value.intervalMinutes ?? 0)
        ? value.intervalMinutes!
        : fallback.intervalMinutes,
      disabledAccountIds: Array.isArray(value.disabledAccountIds)
        ? value.disabledAccountIds.filter((id): id is string => typeof id === 'string')
        : fallback.disabledAccountIds,
      notifications: value.notifications === true,
    };
  } catch {
    return fallback;
  }
}
async function changeNotificationSetting(
  enabled: boolean,
  settings: BackgroundSyncSettings,
  update: (settings: BackgroundSyncSettings) => void,
) {
  if (!enabled) {
    update({ ...settings, notifications: false });
    return;
  }
  if (typeof Notification === 'undefined') {
    update({ ...settings, notifications: false });
    return;
  }
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  update({ ...settings, notifications: permission === 'granted' });
}
function showNewMailNotification(email: string, count: number) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const lastTwo = count % 100;
  const last = count % 10;
  const suffix = lastTwo >= 11 && lastTwo <= 14
    ? 'новых писем'
    : last === 1
      ? 'новое письмо'
      : last >= 2 && last <= 4
        ? 'новых письма'
        : 'новых писем';
  new Notification('Letter Box', {
    body: `${email}: ${count} ${suffix}`,
  });
}
function providerName(provider: AccountStatus['provider']) { return provider === 'mailru' ? 'Mail.ru' : 'Яндекс'; }
function statusName(status: AccountStatus['status']) { return status === 'connected' ? 'Подключён' : status === 'syncing' ? 'Синхронизация…' : status === 'error' ? 'Требует внимания' : 'Не проверен'; }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : 'Произошла неизвестная ошибка'; }
function formatDate(value: string) { const date = new Date(value); return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }); }
function formatSize(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`; }
function formatCount(count: number) { return count > 99 ? '99+' : String(count); }
function mailboxTitle(mailboxes: MailboxInfo[], path: string) {
  const mailbox = mailboxes.find((item) => item.path === path);
  return mailbox ? mailboxDisplayName(mailbox) : path;
}
function mailboxDisplayName(mailbox: MailboxInfo) {
  const names: Record<string, string> = {
    '\\Inbox': 'Входящие',
    '\\Sent': 'Отправленные',
    '\\Drafts': 'Черновики',
    '\\Junk': 'Спам',
    '\\Trash': 'Корзина',
    '\\Archive': 'Архив',
  };
  return mailbox.specialUse ? names[mailbox.specialUse] ?? mailbox.name : mailbox.name;
}
function mailboxIcon(specialUse: string | null) {
  const icons: Record<string, string> = {
    '\\Inbox': '↓',
    '\\Sent': '↑',
    '\\Drafts': '✎',
    '\\Junk': '!',
    '\\Trash': '⌫',
    '\\Archive': '□',
  };
  return specialUse ? icons[specialUse] ?? '•' : '•';
}
function isSeen(message: Message) { return message.flags.includes('\\Seen'); }
function withSeen(flags: string[], seen: boolean) {
  const next = new Set(flags);
  if (seen) next.add('\\Seen');
  else next.delete('\\Seen');
  return [...next];
}
function prepareEmailHtml(html: string) { const base = '<base target="_blank">'; const head = html.match(/<head(?:\s[^>]*)?>/i); if (head?.index !== undefined) { const at = head.index + head[0].length; return `${html.slice(0, at)}${base}${html.slice(at)}`; } return `${base}${html}`; }
