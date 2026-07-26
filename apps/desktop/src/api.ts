const API_URL = new URLSearchParams(window.location.search).get('api')
  ?? 'http://127.0.0.1:3000';

export interface AccountStatus {
  configured: boolean;
  email: string | null;
  provider: 'mailru' | 'yandex' | null;
}

export interface Message {
  uid: number;
  subject: string | null;
  from: {
    name: string | null;
    address: string | null;
  };
  date: string;
  flags: string[];
  size: number;
  body: {
    text: string | null;
    html: string | null;
  } | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Ошибка API: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  account: () => request<AccountStatus>('/account'),
  saveAccount: (account: {
    provider: 'mailru' | 'yandex';
    email: string;
    password: string;
  }) => request<AccountStatus>('/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  }),
  connect: () => request<{ connected: true }>('/imap/connect', { method: 'POST' }),
  sync: () => request<{ synced: number }>('/mail/sync', { method: 'POST' }),
  messages: () => request<Message[]>('/messages'),
  message: (uid: number) => request<Message>(`/messages/${uid}`),
};
