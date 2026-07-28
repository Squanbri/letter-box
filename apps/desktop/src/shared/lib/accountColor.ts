export const ACCOUNT_COLORS = [
  { accent: '#b48326', bg: 'rgba(180, 131, 38, .16)', fg: '#6b4d12' },
  { accent: '#3d6b5c', bg: 'rgba(61, 107, 92, .16)', fg: '#24453b' },
  { accent: '#4a6fa5', bg: 'rgba(74, 111, 165, .16)', fg: '#2b4468' },
  { accent: '#a23c30', bg: 'rgba(162, 60, 48, .16)', fg: '#6e241c' },
  { accent: '#6b5b95', bg: 'rgba(107, 91, 149, .16)', fg: '#433866' },
  { accent: '#5c7a3d', bg: 'rgba(92, 122, 61, .16)', fg: '#374a22' },
] as const;

export type AccountColor = (typeof ACCOUNT_COLORS)[number];

/** Stable palette slot for an account id (same color across lists and charts). */
export function accountColor(accountId: string): AccountColor {
  let hash = 0;
  for (let index = 0; index < accountId.length; index += 1) {
    hash = (hash * 31 + accountId.charCodeAt(index)) | 0;
  }
  return ACCOUNT_COLORS[Math.abs(hash) % ACCOUNT_COLORS.length]!;
}

export function accountChartColor(accountId: string): string {
  return accountColor(accountId).accent;
}
