import { useEffect, useState } from 'react';
import {
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import type { Message, SendMessageInput } from '../../../shared/api/client';
import { errorMessage } from '../../../shared/lib/format';
import { useSendMessageMutation } from '../../../state/mail/mail';

export type ComposeMode = 'new' | 'reply' | 'forward';

export interface ComposeDraft {
  mode: ComposeMode;
  to: string;
  cc: string;
  subject: string;
  text: string;
}

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
    return {
      mode,
      to: from,
      cc: '',
      subject: replySubject(message.subject),
      text: `\n\n\n${date}, ${fromLabel} написал(а):\n\n${quoteText(body)}`,
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
  accountId,
  fromEmail,
  opened,
  draft,
  onClose,
  onSent,
}: {
  accountId: string;
  fromEmail: string;
  opened: boolean;
  draft: ComposeDraft;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [form, setForm] = useState(draft);
  const [showCc, setShowCc] = useState(Boolean(draft.cc));
  const send = useSendMessageMutation(accountId);

  useEffect(() => {
    if (!opened) return;
    setForm(draft);
    setShowCc(Boolean(draft.cc));
    send.reset();
  }, [draft, opened]);

  const title = form.mode === 'reply'
    ? 'Ответ'
    : form.mode === 'forward'
      ? 'Пересылка'
      : 'Новое письмо';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      centered
      size="lg"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const input = toSendInput(form);
          send.mutate(input, {
            onSuccess: () => {
              onSent?.();
              onClose();
            },
          });
        }}
      >
        <Stack>
          <TextInput label="От" value={fromEmail} disabled />
          <TextInput
            label="Кому"
            required
            placeholder="name@example.com"
            value={form.to}
            onChange={(event) => setForm({ ...form, to: event.currentTarget.value })}
          />
          {showCc ? (
            <TextInput
              label="Копия"
              placeholder="name@example.com"
              value={form.cc}
              onChange={(event) => setForm({ ...form, cc: event.currentTarget.value })}
            />
          ) : (
            <Button
              variant="subtle"
              color="gray"
              size="compact-xs"
              w="fit-content"
              onClick={() => setShowCc(true)}
            >
              Добавить копию
            </Button>
          )}
          <TextInput
            label="Тема"
            value={form.subject}
            onChange={(event) => setForm({ ...form, subject: event.currentTarget.value })}
          />
          <Textarea
            label="Сообщение"
            minRows={12}
            autosize
            maxRows={24}
            value={form.text}
            onChange={(event) => setForm({ ...form, text: event.currentTarget.value })}
          />
          {send.error && <Text c="red" size="sm">{errorMessage(send.error)}</Text>}
          <Group justify="flex-end">
            <Button variant="subtle" color="dark" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={send.isPending}>Отправить</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function toSendInput(form: ComposeDraft): SendMessageInput {
  return {
    to: splitAddresses(form.to),
    cc: splitAddresses(form.cc),
    subject: form.subject,
    text: form.text,
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
