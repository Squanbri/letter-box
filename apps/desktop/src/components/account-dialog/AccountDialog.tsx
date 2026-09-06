import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { MailProvider } from '@letter-box/contracts';
import type { AccountInput, AccountStatus } from '../../shared/api/client';
import { errorMessage, providerName } from '../../shared/lib/format';
import { useSaveAccountMutation } from '../../state/accounts/accounts';

const HELP_URLS: Record<MailProvider, string> = {
  mailru: 'https://help.mail.ru/mail/security/protection/applications',
  yandex: 'https://yandex.ru/support/id/authorization/app-passwords.html',
  gmail: 'https://support.google.com/accounts/answer/185833',
};

export function AccountDialog({
  current,
  opened,
  onClose,
  onSaved,
}: {
  current: AccountStatus | null;
  opened: boolean;
  onClose: () => void;
  onSaved: (account: AccountStatus) => void;
}) {
  const [form, setForm] = useState<AccountInput>({
    provider: current?.provider ?? 'mailru',
    email: current?.email ?? '',
    password: '',
  });
  const [detected, setDetected] = useState<MailProvider | null>(current?.provider ?? null);
  const [phase, setPhase] = useState<'idle' | 'checking' | 'error'>('idle');
  const save = useSaveAccountMutation();

  useEffect(() => {
    if (opened) {
      setForm({
        provider: current?.provider ?? 'mailru',
        email: current?.email ?? '',
        password: '',
      });
      setDetected(current?.provider ?? null);
      setPhase('idle');
      save.reset();
    }
  }, [current, opened]);

  const provider = detected ?? form.provider;
  const helpUrl = HELP_URLS[provider];
  const connectedNote = useMemo(() => {
    if (!current) return null;
    return current.status === 'error' ? 'нужен пароль' : 'готов';
  }, [current]);

  if (!opened) return null;

  const onBlurEmail = () => {
    const next = detectProvider(form.email);
    if (next) {
      setDetected(next);
      setForm((value) => ({ ...value, provider: next }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setPhase('checking');
    save.mutate(
      { current, input: { ...form, provider } },
      {
        onSuccess: (account) => {
          setPhase('idle');
          onSaved(account);
        },
        onError: () => setPhase('error'),
      },
    );
  };

  return (
    <div className="account-layer" role="dialog" aria-modal="true" aria-label="Подключение аккаунта">
      <button type="button" className="compose-backdrop" aria-label="Закрыть" onClick={onClose} />
      <section className="account-sheet">
        <aside className="account-hero">
          <p className="account-kicker">Letter Box</p>
          <h2>Почта остаётся у вас</h2>
          <ul>
            <li>Пароль приложения — только в Keychain / сервере LB</li>
            <li>Синхронизация и AI-теги идут локально</li>
            <li>Аккаунт — фильтр внутри тегов, не отдельный ящик-вкладка</li>
          </ul>
        </aside>

        <form className="account-form" onSubmit={submit}>
          <header>
            <h3>{current ? 'Переподключение' : 'Подключить ящик'}</h3>
            <p>Адрес → пароль приложения → проверка IMAP</p>
          </header>

          <label className="account-field">
            <span>Адрес</span>
            <div className={phase === 'error' ? 'account-input error' : 'account-input'}>
              <input
                type="email"
                required
                autoFocus={!current}
                placeholder="you@mail.ru"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.currentTarget.value })}
                onBlur={onBlurEmail}
              />
              {detected && (
                <em>{providerName(detected)} ✓</em>
              )}
            </div>
          </label>

          <label className="account-field">
            <span>Пароль приложения</span>
            <div className={phase === 'error' ? 'account-input error' : 'account-input'}>
              <input
                type="password"
                required
                autoComplete="off"
                placeholder="не обычный пароль от ящика"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
              />
            </div>
            <a className="account-help" href={helpUrl} target="_blank" rel="noreferrer">
              где взять для {providerName(provider)} ↗
            </a>
          </label>

          {phase === 'checking' && (
            <div className="account-status checking">
              <span className="lb-spinner" aria-hidden />
              Проверяем соединение — вход выполнен, читаем список папок…
            </div>
          )}

          {save.error && (
            <div className="account-status error">
              <strong>Не удалось подключить</strong>
              <p>{errorMessage(save.error)}</p>
              <div className="account-error-actions">
                <button type="submit" className="compose-ghost">Повторить</button>
                <a className="account-help" href={helpUrl} target="_blank" rel="noreferrer">
                  Инструкция ↗
                </a>
              </div>
            </div>
          )}

          {connectedNote && (
            <p className="account-connected">Уже подключено · {form.email || current?.email} · {connectedNote}</p>
          )}

          <footer className="account-form-footer">
            <button type="button" className="compose-ghost" onClick={onClose}>Отмена</button>
            <button type="submit" className="compose-send" disabled={save.isPending}>
              {current ? 'Переподключить' : 'Подключить ящик'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function detectProvider(email: string): MailProvider | null {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain) return null;
  if (
    domain === 'mail.ru'
    || domain.endsWith('.mail.ru')
    || domain === 'inbox.ru'
    || domain === 'list.ru'
    || domain === 'bk.ru'
  ) {
    return 'mailru';
  }
  if (domain === 'yandex.ru' || domain === 'ya.ru' || domain.endsWith('.yandex.ru')) {
    return 'yandex';
  }
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return 'gmail';
  }
  return null;
}
