import type { AccountStatus } from '@letter-box/contracts';

export interface AccountRow {
  id: string;
  provider: 'mailru' | 'yandex' | 'gmail';
  email: string;
  status: AccountStatus['status'];
  last_error: string | null;
  last_sync_at: string | null;
  unread_count: number;
}
