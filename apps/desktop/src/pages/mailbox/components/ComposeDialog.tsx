import { useEffect, useMemo, useState } from 'react';
import { WindowTrafficLights } from '../../../components/window-controls/WindowTrafficLights';
import type { AccountStatus, Message, SendMessageInput } from '../../../shared/api/client';
import { accountColor } from '../../../shared/lib/accountColor';
import { errorMessage } from '../../../shared/lib/format';
import { useSendMessageMutation } from '../../../state/mail/mail';

export type ComposeMode = 'new' | 'reply' | 'forward';

export interface ComposeDraft {
  mode: ComposeMode;
  to: string;
  cc: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}

export type ComposeThreadEntry = {
  id: string;
  from: string;
  preview: string;
  date: string;
  current?: boolean;
};

export type ComposeState = {
  accountId: string;
  draft: ComposeDraft;
  thread?: ComposeThreadEntry[];
  tagHint?: string | null;
};

export function buildComposeDraft(
  mode: ComposeMode,
  message?: Message | null,
): ComposeDraft {
  if (!message || mode === 'new') {
    return { mode: 'new', to: '', cc: '', subject: '', text: '' };
  }

  const from = message.from.address ?? '';
  const fromLabel = message.from.name
    ? `${message.from.name} <${from}>`
    : from;
  const body = message.body?.text
    || (message.body?.html ? stripHtml(message.body.html) : '')
    || '';
  const date = new Date(message.date).toLocaleString('ru-RU');

  if (mode === 'reply') {
    const parentId = message.messageId ?? undefined;
    const references = [
      ...message.references,
      ...(parentId ? [parentId] : []),
    ].filter(Boolean);
    return {
      mode,
      to: from,
      cc: '',
      subject: replySubject(message.subject),
      text: `\n\n\n${date}, ${fromLabel} написал(а):\n\n${quoteText(body)}`,
      inReplyTo: parentId,
      references: references.length ? references.join(' ') : undefined,
    };
  }

  return {
    mode,
    to: '',
    cc: '',
    subject: forwardSubject(message.subject),
    text: [
      '',
      '',
      '---------- Пересланное сообщение ----------',
      `От: ${fromLabel}`,
      `Дата: ${date}`,
      `Тема: ${message.subject || '(без темы)'}`,
      '',
      body,
    ].join('\n'),
  };
}

export function ComposeDialog({
  accounts,
  state,
  onClose,
  onChangeAccount,
  onSent,
  windowMode = false,
}: {
  accounts: AccountStatus[];
  state: ComposeState;
  onClose: () => void;
  onChangeAccount?: (accountId: string) => void;
  onSent?: () => void;
  windowMode?: boolean;
}) {
  const { accountId, draft, thread, tagHint } = state;
  const [form, setForm] = useState(draft);
  const [showCc, setShowCc] = useState(Boolean(draft.cc));
  const send = useSendMessageMutation(accountId);
  const fromEmail = accounts.find((account) => account.id === accountId)?.email ?? '';
  const hasThread = Boolean(thread?.length);

  useEffect(() => {
    setForm(draft);
    setShowCc(Boolean(draft.cc));
    send.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, accountId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !windowMode) {
        onClose();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        const input = toSendInput(form);
        if (!input.to.length || send.isPending) return;
        send.mutate(input, {
          onSuccess: () => {
            onSent?.();
            onClose();
          },
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, onClose, onSent, send, windowMode]);

  const title = form.mode === 'reply'
    ? 'Ответ'
    : form.mode === 'forward'
      ? 'Пересылка'
      : 'Новое письмо';

  const accountOptions = useMemo(() => accounts, [accounts]);

  const submit = () => {
    if (send.isPending) return;
    const input = toSendInput(form);
    if (!input.to.length) return;
    send.mutate(input, {
      onSuccess: () => {
        onSent?.();
        onClose();
      },
    });
  };

  const sheetClass = [
    'compose-sheet',
    windowMode ? 'window-mode' : '',
    hasThread ? 'with-thread' : '',
  ].filter(Boolean).join(' ');

  const editorBody = (
    <>
      {!windowMode && (
        <header className="compose-sheet-header">
          <div>
            <p className="compose-kicker">{title}</p>
            <h2>{form.subject.trim() || 'Без темы'}</h2>
          </div>
          <button type="button" className="compose-icon-btn" onClick={onClose} title="Закрыть · Esc">
            ✕
          </button>
        </header>
      )}

      <div className="compose-meta">
        <label className="compose-field">
          <span>От</span>
          {accountOptions.length > 1 && onChangeAccount ? (
            <select
              value={accountId}
              onChange={(event) => onChangeAccount(event.currentTarget.value)}
            >
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>{account.email}</option>
              ))}
            </select>
          ) : (
            <div className="compose-from-static">
              <span
                className="account-dot"
                style={{ background: accountColor(accountId).accent }}
              />
              {fromEmail}
            </div>
          )}
        </label>

        <label className="compose-field">
          <span>Кому</span>
          <input
            autoFocus
            required
            placeholder="name@example.com"
            value={form.to}
            onChange={(event) => setForm({ ...form, to: event.currentTarget.value })}
          />
        </label>

        {showCc ? (
          <label className="compose-field">
            <span>Копия</span>
            <input
              placeholder="name@example.com"
              value={form.cc}
              onChange={(event) => setForm({ ...form, cc: event.currentTarget.value })}
            />
          </label>
        ) : (
          <button type="button" className="compose-link" onClick={() => setShowCc(true)}>
            + Копия
          </button>
        )}

        <label className="compose-field">
          <span>Тема</span>
          <input
            placeholder="Без темы"
            value={form.subject}
            onChange={(event) => setForm({ ...form, subject: event.currentTarget.value })}
          />
        </label>
      </div>

      <textarea
        className="compose-body"
        placeholder="Текст письма…"
        value={form.text}
        onChange={(event) => setForm({ ...form, text: event.currentTarget.value })}
      />

      <footer className="compose-sheet-footer">
        <span className="compose-hint">
          {form.mode === 'new'
            ? 'Тег назначит Ollama после отправки · ⌘⏎'
            : 'Отправить ⌘⏎'}
        </span>
        <div className="compose-actions">
          {send.error && <p className="compose-error">{errorMessage(send.error)}</p>}
          {!windowMode && (
            <button type="button" className="compose-ghost" onClick={onClose}>Отмена</button>
          )}
          <button
            type="button"
            className="compose-send"
            disabled={send.isPending || !form.to.trim()}
            onClick={submit}
          >
            {send.isPending ? 'Отправка…' : 'Отправить'}
          </button>
        </div>
      </footer>
    </>
  );

  const sheet = (
    <section className={sheetClass}>
      {windowMode && (
        <header className="compose-window-titlebar">
          <WindowTrafficLights vertical={false} className="compose-traffic" />
          <div className="compose-window-title">
            <p className="compose-kicker">{title}</p>
            <h2>{form.subject.trim() || 'Без темы'}</h2>
          </div>
          <span className="compose-draft-stamp">Черновик</span>
        </header>
      )}
      {hasThread && (
        <aside className="compose-thread-col">
          <header>Контекст ветки</header>
          <div className="compose-thread-list">
            {thread!.map((entry) => (
              <div
                key={entry.id}
                className={entry.current ? 'compose-thread-item current' : 'compose-thread-item'}
              >
                <strong>{entry.from}</strong>
                <p>{entry.preview}</p>
                <em>{entry.date}</em>
                {entry.current && <span>отвечаете на это</span>}
              </div>
            ))}
          </div>
          <footer>
            {tagHint ? `Попадёт в тег: ${tagHint}` : 'Тег сохранится у ветки'}
          </footer>
        </aside>
      )}
      {hasThread ? <div className="compose-editor-col">{editorBody}</div> : editorBody}
    </section>
  );

  if (windowMode) {
    return <div className="compose-window-root">{sheet}</div>;
  }

  return (
    <div className="compose-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="compose-backdrop" aria-label="Закрыть" onClick={onClose} />
      {sheet}
    </div>
  );
}

function toSendInput(form: ComposeDraft): SendMessageInput {
  return {
    to: splitAddresses(form.to),
    cc: splitAddresses(form.cc),
    subject: form.subject,
    text: form.text,
    inReplyTo: form.inReplyTo,
    references: form.references,
  };
}

function splitAddresses(value: string): string[] {
  return value.split(/[,;]+/).map((item) => item.trim()).filter(Boolean);
}

function replySubject(subject: string | null): string {
  const value = subject?.trim() || '';
  if (!value) return 'Re:';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}

function forwardSubject(subject: string | null): string {
  const value = subject?.trim() || '';
  if (!value) return 'Fwd:';
  return /^(fwd|fw):/i.test(value) ? value : `Fwd: ${value}`;
}

function quoteText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/p>/giu, '\n\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&amp;/giu, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
