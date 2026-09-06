import { useState } from 'react';
import {
  Button,
  Card,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/lib/format';
import { BrandLogo } from '../../shared/ui/BrandLogo';
import { useAuth } from '../../state/auth/AuthProvider';

export function AuthPage() {
  const { authenticate } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="auth-screen">
      <Card className="auth-card" withBorder shadow="lg" radius="md" p="xl">
        <form onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          void (mode === 'login'
            ? api.login({ email, password })
            : api.register({ email, password }))
            .then(authenticate)
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setPending(false));
        }}>
          <Stack>
            <div className="status-mark">
              <BrandLogo size={28} />
            </div>
            <div>
              <Text className="eyebrow">Letter Box</Text>
              <Title order={2}>{mode === 'login' ? 'Вход' : 'Создание пользователя'}</Title>
              <Text size="sm" c="dimmed" mt="xs">Авторизуйтесь, чтобы получить доступ только к своим почтовым аккаунтам.</Text>
            </div>
            <TextInput label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
            <PasswordInput label="Пароль" required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
            {error && <Text c="red" size="sm">{error}</Text>}
            <Button type="submit" loading={pending}>{mode === 'login' ? 'Войти' : 'Создать пользователя'}</Button>
            <Button variant="subtle" color="dark" onClick={() => {
              setMode((current) => current === 'login' ? 'register' : 'login');
              setError(null);
            }}>
              {mode === 'login' ? 'Создать пользователя' : 'У меня уже есть пользователь'}
            </Button>
          </Stack>
        </form>
      </Card>
    </main>
  );
}
