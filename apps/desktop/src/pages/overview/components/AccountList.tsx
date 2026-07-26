import { ActionIcon, Checkbox, Tooltip } from '@mantine/core';
import type { AccountStatus } from '../../../shared/api/client';
import { formatDate, providerName } from '../../../shared/lib/format';

export function AccountList({
  accounts,
  disabledAccountIds,
  onOpen,
  onAdd,
  onReconnect,
  onDelete,
  onAccountSync,
}: {
  accounts: AccountStatus[];
  disabledAccountIds: string[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onReconnect: (account: AccountStatus) => void;
  onDelete: (account: AccountStatus) => void;
  onAccountSync: (id: string, enabled: boolean) => void;
}) {
  return (
    <section className="dashboard-card accounts-panel">
      <header><div><span className="eyebrow">Почтовые ящики</span><h2>Аккаунты</h2></div><small>{accounts.length} всего</small></header>
      <div className="account-list">
        {accounts.map((account) => (
          <article className="overview-account" key={account.id}>
            <button className="account-main" onClick={() => onOpen(account.id)}>
              <span className={`status-dot ${account.status}`} />
              <span className="account-identity"><strong>{account.email}</strong><small>{providerName(account.provider)} · {account.lastSyncAt ? `обновлено ${formatDate(account.lastSyncAt)}` : 'ещё не обновлялся'}</small></span>
              <span className="account-summary"><strong>{account.unreadCount}</strong><small>непрочитанных</small></span>
            </button>
            <div className="account-tools">
              <Checkbox
                size="xs"
                label="Авто"
                checked={!disabledAccountIds.includes(account.id)}
                onChange={(event) => onAccountSync(account.id, event.currentTarget.checked)}
              />
              <Tooltip label="Переподключить">
                <ActionIcon variant="light" color="gray" onClick={() => onReconnect(account)}>↻</ActionIcon>
              </Tooltip>
              <Tooltip label="Удалить">
                <ActionIcon variant="light" color="red" onClick={() => onDelete(account)}>×</ActionIcon>
              </Tooltip>
            </div>
            {account.lastError && <p>{account.lastError}</p>}
          </article>
        ))}
        {accounts.length === 0 && (
          <div className="empty-overview"><strong>Подключите первую почту</strong><span>Mail.ru, Яндекс и Gmail доступны уже сейчас.</span><button onClick={onAdd}>Добавить аккаунт</button></div>
        )}
      </div>
    </section>
  );
}
