import {
  MESSAGE_TAGS,
  MESSAGE_TAG_LABELS,
  type MessageTag,
} from '@letter-box/contracts';

export { MESSAGE_TAGS, MESSAGE_TAG_LABELS, type MessageTag };

const TAG_SET = new Set<string>(MESSAGE_TAGS);

const IMPORTANT_PATTERNS = [
  /\b(otp|2fa|mfa)\b/i,
  /\bverification\s+code\b/i,
  /\bverify\s+it'?s\s+you\b/i,
  /разовый\s+код/i,
  /код\s+(подтверждения|безопасности|входа|из\s+письма)/i,
  /подтвердите\s+(вход|почту|email|это\s+вы)/i,
  /security\s+(alert|advisory|notification|code)/i,
  /оповещение\s+системы\s+безопасности/i,
  /вход\s+с\s+нового\s+устройства/i,
  /\bnew\s+login\s+to\b/i,
  /sign[- ]?in\s+(from|attempt|detected|alert)/i,
  /пароль\s+.+\s+(изменен|изменён|создан|сброшен)/i,
  /\bpassword\s+(was\s+)?(changed|reset|created)\b/i,
  /создали\s+пароль\s+для\s+приложения/i,
  /сбросить\s+пароль/i,
  /\breset\s+your\s+password\b/i,
  /account\s+lock/i,
  /дедлайн|deadline|экзамен|зач[её]т|assignment\s+due/i,
];

const IMPORTANT_EXCLUDE_PATTERNS = [
  /login\s+reward/i,
  /weekly\s+digest/i,
  /\bnewsletter\b/i,
  /don'?t\s+miss/i,
  /чемпионат\s+болельщиков/i,
];

export function normalizeTags(value: unknown): MessageTag[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? extractJsonArray(value) ?? value.split(/[,\s]+/)
      : [];
  let tags = [...new Set(
    source
      .map((item) => String(item).trim().toLowerCase())
      .filter((item): item is MessageTag => TAG_SET.has(item)),
  )].slice(0, 3);
  // Marketing is never "important"; small models often over-tag both.
  if (tags.includes('important') && tags.includes('promo')) {
    tags = tags.filter((tag) => tag !== 'important');
  }
  return tags.length > 0 ? tags : ['other'];
}

export function looksImportant(input: {
  subject: string | null;
  from: string | null;
  text: string;
}): boolean {
  const haystack = [input.subject, input.from, input.text.slice(0, 500)]
    .filter(Boolean)
    .join('\n');
  if (!haystack.trim()) return false;
  if (IMPORTANT_EXCLUDE_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return false;
  }
  return IMPORTANT_PATTERNS.some((pattern) => pattern.test(haystack));
}

/** OTP/security/deadline heuristics — reliable on tiny models that overuse promo. */
export function applyImportantHeuristic(input: {
  subject: string | null;
  from: string | null;
  text: string;
  tags: MessageTag[];
}): MessageTag[] {
  if (!looksImportant(input)) return input.tags;
  const withoutPromo = input.tags.filter((tag) => tag !== 'promo');
  const tags = withoutPromo.includes('important')
    ? withoutPromo
    : (['important', ...withoutPromo] as MessageTag[]);
  return [...new Set(tags)].slice(0, 3);
}

export function buildClassificationPrompt(input: {
  subject: string | null;
  from: string | null;
  text: string;
}): string {
  return [
    'You tag emails. Reply with JSON only, no markdown.',
    'Schema: {"tags":["promo"]}',
    'Choose 1-3 tags from this list only:',
    '- important: OTP/2FA/login codes, security alerts, new device logins, password changes, account lockouts, unpaid invoices due, exam/assignment deadlines',
    '- spam: scam, phishing, fake invoices, malware',
    '- promo: marketing, sales, discounts, newsletters, ads',
    '- work: job, colleagues, clients, meetings, HR',
    '- games: games, Steam, Xbox, PlayStation, esports',
    '- news: news digests, media outlets',
    '- it: programming, DevOps, GitHub, cloud, SaaS tools',
    '- personal: friends, family, private life',
    '- finance: banks, bills, payments, taxes, receipts',
    '- other: anything else',
    'Rules:',
    '- Prefer promo over spam for legitimate marketing.',
    '- Prefer spam for phishing/scam.',
    '- Do not default to work or it.',
    '- Always add important for OTP/login codes, security alerts, new-device sign-ins, and password changes. Combine with work/it/finance when useful.',
    '- Never use important for marketing, digests, birthday wishes, parties, cleanup days, or casual chat.',
    '- If unsure about other tags, use other.',
    `From: ${input.from || 'unknown'}`,
    `Subject: ${input.subject || '(no subject)'}`,
    `Body: ${input.text.slice(0, 1200)}`,
  ].join('\n');
}

function extractJsonArray(value: string): unknown[] | null {
  const match = value.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseClassificationResponse(raw: string): MessageTag[] {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { tags?: unknown };
      if (parsed.tags !== undefined) return normalizeTags(parsed.tags);
    }
  } catch {
    // fall through to free-form parsing
  }
  return normalizeTags(raw);
}
