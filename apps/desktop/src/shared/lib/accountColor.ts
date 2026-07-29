export const ACCOUNT_COLORS = [
  { accent: '#2774e6', bg: 'rgba(39, 116, 230, .14)', fg: '#1550b0' },
  { accent: '#d63e83', bg: 'rgba(214, 62, 131, .14)', fg: '#a02862' },
  { accent: '#e66b18', bg: 'rgba(230, 107, 24, .14)', fg: '#b04e0e' },
  { accent: '#7c4ddb', bg: 'rgba(124, 77, 219, .14)', fg: '#5a30b0' },
  { accent: '#0096b7', bg: 'rgba(0, 150, 183, .14)', fg: '#006d87' },
  { accent: '#65a30d', bg: 'rgba(101, 163, 13, .14)', fg: '#427008' },
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
