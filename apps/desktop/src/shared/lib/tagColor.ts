import type { MessageTag } from '@letter-box/contracts';

export const TAG_COLORS: Record<MessageTag, { ink: string; bg: string }> = {
  important: { ink: '#b3421c', bg: '#f6e8e1' },
  work: { ink: '#1550b0', bg: '#e8eef8' },
  finance: { ink: '#1f7a4d', bg: '#e4efe7' },
  promo: { ink: '#a06a08', bg: '#f6efdd' },
  personal: { ink: '#a02862', bg: '#f8e9f0' },
  it: { ink: '#006d87', bg: '#e7f1f4' },
  games: { ink: '#5a30b0', bg: '#f1ecfb' },
  news: { ink: '#006d87', bg: '#e7f1f4' },
  spam: { ink: '#8d887a', bg: '#f2efe6' },
  other: { ink: '#8d887a', bg: '#f2efe6' },
};

export const PRIMARY_NAV_TAGS: MessageTag[] = [
  'important',
  'finance',
  'work',
  'it',
  'promo',
  'personal',
  'games',
];

export const HIDDEN_DASHBOARD_TAGS: MessageTag[] = ['spam', 'other'];

export function tagColor(tag: string): string {
  return TAG_COLORS[tag as MessageTag]?.ink ?? '#8d887a';
}

export function tagBg(tag: string): string {
  return TAG_COLORS[tag as MessageTag]?.bg ?? '#f2efe6';
}

export function tagGlyph(tag: MessageTag): string {
  const glyphs: Record<MessageTag, string> = {
    important: '!',
    finance: '₽',
    work: '▤',
    it: '‹›',
    promo: '%',
    personal: '♡',
    games: '◇',
    news: '☰',
    spam: '⊘',
    other: '·',
  };
  return glyphs[tag];
}
