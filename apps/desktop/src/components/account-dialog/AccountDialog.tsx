import { useEffect, useState } from 'react';
import {
  Button,
  Group,
  Modal,
  PasswordInput,
  Radio,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import type { AccountInput, AccountStatus } from '../../shared/api/client';
import { errorMessage, providerName } from '../../shared/lib/format';
import { useSaveAccountMutation } from '../../state/accounts/accounts';

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
  const save = useSaveAccountMutation();

  useEffect(() => {
    if (opened) {
      setForm({
        provider: current?.provider ?? 'mailru',
        email: current?.email ?? '',
        password: '',
      });
      save.reset();
    }
  }, [current, opened]);

  return (
    <Modal opened={opened} onClose={onClose} title={current ? 'Переподключение' : 'Новый аккаунт'} centered>
      <form onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ current, input: form }, { onSuccess: onSaved });
      }}>
        <Stack>
          <Text size="sm" c="dimmed">
            Используйте отдельный пароль приложения. Он будет зашифрован на сервере Letter Box.
          </Text>
          <Radio.Group
            label="Почтовый сервис"
            value={form.provider}
            onChange={(provider) => setForm({ ...form, provider: provider as AccountInput['provider'] })}
          >
            <Group mt="xs">
              {(['mailru', 'yandex', 'gmail'] as const).map((provider) => (
                <Radio key={provider} value={provider} label={providerName(provider)} />
              ))}
            </Group>
          </Radio.Group>
          <TextInput
            label="Email"
            type="email"
            required
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.currentTarget.value })}
          />
          <PasswordInput
            label="Пароль приложения"
            required
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
          />
          {save.error && <Text c="red" size="sm">{errorMessage(save.error)}</Text>}
          <Group justify="flex-end">
            <Button variant="subtle" color="dark" onClick={onClose}>Отмена</Button>
            <Button type="submit" loading={save.isPending}>
              {current ? 'Переподключить' : 'Добавить'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
