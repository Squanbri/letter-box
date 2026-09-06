import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { OAUTH_PROVIDERS, type BasicAccountInput, type MailProvider } from '@letter-box/contracts';
import type { AccountStatus } from '../../shared/api/client';
import { errorMessage } from '../../shared/lib/format';
import { accountKeys, useSaveBasicAccountMutation } from '../../state/accounts/accounts';

type Step = 'picker' | 'waiting' | 'yandex-code' | 'imap' | 'success';

const MAILRU_HELP = 'https://help.mail.ru/mail/security/protection/applications';

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
  const [step, setStep] = useState<Step>('picker');
  const [basicProvider, setBasicProvider] = useState<'mailru' | 'imap'>('imap');
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yandexCode, setYandexCode] = useState('');
  const [yandexBusy, setYandexBusy] = useState(false);
  const [form, setForm] = useState<BasicAccountInput>(emptyBasic(current, 'imap'));
  const saveBasic = useSaveBasicAccountMutation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!opened) return;
    setError(null);
    setConnectedEmail(null);
    setYandexCode('');
    setYandexBusy(false);
    saveBasic.reset();
    if (current?.provider === 'imap') {
      setBasicProvider('imap');
      setForm(emptyBasic(current, 'imap'));
      setStep('imap');
      return;
    }
    if (current?.provider === 'mailru') {
      setBasicProvider('mailru');
      setForm(emptyBasic(current, 'mailru'));
      setStep('imap');
      return;
    }
    setBasicProvider('imap');
    setForm(emptyBasic(current, 'imap'));
    setStep('picker');
  }, [current, opened]);

  useEffect(() => {
    if (!opened) return undefined;
    return window.letterBoxAccounts?.onOnboarding((event) => {
      if (event.phase === 'waiting-browser') setStep('waiting');
      if (event.phase === 'waiting-code') setStep('yandex-code');
      if (event.phase === 'checking') setYandexBusy(true);
      if (event.phase === 'error' && event.message) {
        setYandexBusy(false);
        setError(event.message);
      }
      if (event.phase === 'success' && event.email) setConnectedEmail(event.email);
    });
  }, [opened]);

  if (!opened) return null;

  const finish = (account: AccountStatus) => {
    setConnectedEmail(account.email);
    setStep('success');
    void queryClient.invalidateQueries({ queryKey: accountKeys.all });
    window.setTimeout(() => onSaved(account), 1_400);
  };

  const close = () => {
    void window.letterBoxAccounts?.cancelOAuth();
    onClose();
  };

  const completeOAuth = async (providerId: 'gmail' | 'yandex') => {
    if (!window.letterBoxAccounts) {
      setError('OAuth доступен только в desktop-клиенте Letter Box');
      return;
    }
    setError(null);
    try {
      const result = await window.letterBoxAccounts.addOAuth({
        providerId,
        accountId: current?.id,
      });
      if (result && typeof result === 'object' && 'cancelled' in result) return;
      if (result && typeof result === 'object' && 'error' in result) {
        setYandexBusy(false);
        setError(String((result as { error: string }).error));
        return;
      }
      finish(result as AccountStatus);
    } catch (reason) {
      setYandexBusy(false);
      setError(errorMessage(reason));
    }
  };

  const startGmail = () => {
    setStep('waiting');
    void completeOAuth('gmail');
  };

  const startYandex = () => {
    setYandexCode('');
    setYandexBusy(false);
    setStep('yandex-code');
    void completeOAuth('yandex');
  };

  const submitYandexCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!window.letterBoxAccounts) return;
    setError(null);
    setYandexBusy(true);
    const submitted = await window.letterBoxAccounts.submitOAuthCode(yandexCode);
    if (submitted && typeof submitted === 'object' && 'error' in submitted) {
      setYandexBusy(false);
      setError(String((submitted as { error: string }).error));
    }
  };

  const openBasic = (provider: 'mailru' | 'imap') => {
    setError(null);
    setBasicProvider(provider);
    setForm(emptyBasic(current, provider));
    setStep('imap');
  };

  const submitImap = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    saveBasic.mutate(
      { current, input: form },
      {
        onSuccess: (account) => finish(account),
        onError: (reason) => setError(errorMessage(reason)),
      },
    );
  };

  const hostsVisible = basicProvider === 'imap';

  return (
    <div className="account-layer" role="dialog" aria-modal="true" aria-label="Подключение аккаунта">
      <button type="button" className="compose-backdrop" aria-label="Закрыть" onClick={close} />
      <section className="account-sheet">
        <aside className="account-hero">
          <p className="account-kicker">Letter Box</p>
          <h2>Почта остаётся у вас</h2>
          <ul>
            <li>Gmail — OAuth в системном браузере</li>
            <li>Яндекс — код с страницы подтверждения</li>
            <li>Mail.ru и прочий IMAP — пароль приложения</li>
          </ul>
        </aside>

        <div className="account-form">
          {step === 'picker' && (
            <>
              <header>
                <h3>{current ? 'Переподключение' : 'Добавить почту'}</h3>
                <p>Способ входа зависит от сервиса</p>
              </header>
              <div className="account-provider-grid">
                <button type="button" className="account-provider-tile" onClick={startGmail}>
                  <strong>Gmail</strong>
                  <span>вход через Google</span>
                </button>
                <button type="button" className="account-provider-tile" onClick={startYandex}>
                  <strong>Яндекс</strong>
                  <span>вставить код из браузера</span>
                </button>
                <button type="button" className="account-provider-tile" onClick={() => openBasic('mailru')}>
                  <strong>Mail.ru</strong>
                  <span>пароль приложения</span>
                </button>
                <button type="button" className="account-provider-tile" onClick={() => openBasic('imap')}>
                  <strong>Другой IMAP</strong>
                  <span>логин, пароль и серверы</span>
                </button>
              </div>
              {current && (
                <p className="account-connected">
                  Уже подключено · {current.email} · {current.status === 'needs_reauth' ? 'нужна повторная авторизация' : current.status}
                </p>
              )}
            </>
          )}

          {step === 'waiting' && (
            <>
              <header>
                <h3>Ожидаем подтверждение в браузере</h3>
                <p>Gmail</p>
              </header>
              <div className="account-status checking">
                <span className="lb-spinner" aria-hidden />
                Откроется системный браузер. Подтвердите доступ и вернитесь сюда.
              </div>
              {error && (
                <div className="account-status error">
                  <strong>Не удалось подключить</strong>
                  <p>{error}</p>
                  <div className="account-error-actions">
                    <button type="button" className="compose-ghost" onClick={startGmail}>
                      Повторить
                    </button>
                  </div>
                </div>
              )}
              <footer className="account-form-footer">
                <button
                  type="button"
                  className="compose-ghost"
                  onClick={() => {
                    void window.letterBoxAccounts?.cancelOAuth();
                    setStep('picker');
                    setError(null);
                  }}
                >
                  Отменить
                </button>
              </footer>
            </>
          )}

          {step === 'yandex-code' && (
            <form onSubmit={(event) => void submitYandexCode(event)}>
              <header>
                <h3>Код Яндекса</h3>
                <p>Скопируйте код со страницы oauth.yandex.ru и вставьте сюда</p>
              </header>
              <label className="account-field">
                <span>Код подтверждения</span>
                <div className={error ? 'account-input error' : 'account-input'}>
                  <input
                    required
                    autoFocus
                    autoComplete="off"
                    placeholder="код с страницы Яндекса"
                    value={yandexCode}
                    onChange={(event) => setYandexCode(event.currentTarget.value)}
                  />
                </div>
              </label>
              {yandexBusy && (
                <div className="account-status checking">
                  <span className="lb-spinner" aria-hidden />
                  Обмениваем код и проверяем IMAP…
                </div>
              )}
              {error && (
                <div className="account-status error">
                  <strong>Не удалось подключить</strong>
                  <p>{error}</p>
                </div>
              )}
              <footer className="account-form-footer">
                <button
                  type="button"
                  className="compose-ghost"
                  onClick={() => {
                    void window.letterBoxAccounts?.cancelOAuth();
                    setYandexBusy(false);
                    setStep('picker');
                    setError(null);
                  }}
                >
                  Отменить
                </button>
                {error && (
                  <button type="button" className="compose-ghost" onClick={startYandex}>
                    Повторить
                  </button>
                )}
                <button type="submit" className="compose-send" disabled={yandexBusy || !yandexCode.trim()}>
                  Подтвердить
                </button>
              </footer>
            </form>
          )}

          {step === 'imap' && (
            <form onSubmit={submitImap}>
              <header>
                <h3>{basicProvider === 'mailru' ? 'Mail.ru' : 'Другой IMAP'}</h3>
                <p>
                  {basicProvider === 'mailru'
                    ? 'Email и пароль приложения'
                    : 'Email, пароль приложения и серверы'}
                </p>
              </header>
              <label className="account-field">
                <span>Адрес</span>
                <div className={error ? 'account-input error' : 'account-input'}>
                  <input
                    type="email"
                    required
                    autoFocus
                    placeholder={basicProvider === 'mailru' ? 'you@mail.ru' : 'you@example.com'}
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.currentTarget.value })}
                  />
                </div>
              </label>
              <label className="account-field">
                <span>Пароль приложения</span>
                <div className={error ? 'account-input error' : 'account-input'}>
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
                  />
                </div>
                {basicProvider === 'mailru' && (
                  <a className="account-help" href={MAILRU_HELP} target="_blank" rel="noreferrer">
                    где взять пароль приложения ↗
                  </a>
                )}
              </label>
              {hostsVisible && (
                <>
                  <div className="account-host-grid">
                    <label className="account-field">
                      <span>IMAP host</span>
                      <div className="account-input">
                        <input
                          required
                          placeholder="imap.example.com"
                          value={form.imapHost ?? ''}
                          onChange={(event) => setForm({ ...form, imapHost: event.currentTarget.value })}
                        />
                      </div>
                    </label>
                    <label className="account-field">
                      <span>IMAP port</span>
                      <div className="account-input">
                        <input
                          type="number"
                          required
                          value={form.imapPort ?? 993}
                          onChange={(event) => setForm({ ...form, imapPort: Number(event.currentTarget.value) })}
                        />
                      </div>
                    </label>
                    <label className="account-field">
                      <span>SMTP host</span>
                      <div className="account-input">
                        <input
                          required
                          placeholder="smtp.example.com"
                          value={form.smtpHost ?? ''}
                          onChange={(event) => setForm({ ...form, smtpHost: event.currentTarget.value })}
                        />
                      </div>
                    </label>
                    <label className="account-field">
                      <span>SMTP port</span>
                      <div className="account-input">
                        <input
                          type="number"
                          required
                          value={form.smtpPort ?? 587}
                          onChange={(event) => setForm({ ...form, smtpPort: Number(event.currentTarget.value) })}
                        />
                      </div>
                    </label>
                  </div>
                  <label className="account-ssl">
                    <input
                      type="checkbox"
                      checked={form.useSSL !== false}
                      onChange={(event) => setForm({ ...form, useSSL: event.currentTarget.checked })}
                    />
                    SSL / STARTTLS
                  </label>
                </>
              )}
              {saveBasic.isPending && (
                <div className="account-status checking">
                  <span className="lb-spinner" aria-hidden />
                  Проверяем IMAP-подключение…
                </div>
              )}
              {error && (
                <div className="account-status error">
                  <strong>Не удалось подключить</strong>
                  <p>{error}</p>
                </div>
              )}
              <footer className="account-form-footer">
                <button
                  type="button"
                  className="compose-ghost"
                  onClick={() => {
                    setStep('picker');
                    setError(null);
                  }}
                >
                  Назад
                </button>
                <button type="submit" className="compose-send" disabled={saveBasic.isPending}>
                  {current ? 'Переподключить' : 'Подключить ящик'}
                </button>
              </footer>
            </form>
          )}

          {step === 'success' && (
            <>
              <header>
                <h3>Аккаунт подключён</h3>
                <p>IMAP проверен, ящик готов к синхронизации</p>
              </header>
              <div className="account-status checking">
                {connectedEmail ?? current?.email}
              </div>
              <footer className="account-form-footer">
                <button type="button" className="compose-send" onClick={onClose}>Готово</button>
              </footer>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function emptyBasic(
  current: AccountStatus | null,
  provider: Extract<MailProvider, 'mailru' | 'imap'>,
): BasicAccountInput {
  const mailru = OAUTH_PROVIDERS.mailru;
  if (provider === 'mailru') {
    return {
      authType: 'basic',
      provider: 'mailru',
      email: current?.provider === 'mailru' ? current.email : '',
      password: '',
      imapHost: mailru.imapHost,
      imapPort: mailru.imapPort,
      smtpHost: mailru.smtpHost,
      smtpPort: mailru.smtpPort,
      useSSL: true,
    };
  }
  return {
    authType: 'basic',
    provider: 'imap',
    email: current?.provider === 'imap' ? current.email : '',
    password: '',
    imapHost: '',
    imapPort: 993,
    smtpHost: '',
    smtpPort: 587,
    useSSL: true,
  };
}
