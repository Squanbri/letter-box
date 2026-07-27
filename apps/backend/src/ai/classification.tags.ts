import {
  MESSAGE_TAGS,
  MESSAGE_TAG_LABELS,
  type MessageTag,
} from '@letter-box/contracts';

export { MESSAGE_TAGS, MESSAGE_TAG_LABELS, type MessageTag };

const TAG_SET = new Set<string>(MESSAGE_TAGS);

export function normalizeTags(value: unknown): MessageTag[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? extractJsonArray(value) ?? value.split(/[,\s]+/)
      : [];
  const tags = [...new Set(
    source
      .map((item) => String(item).trim().toLowerCase())
      .filter((item): item is MessageTag => TAG_SET.has(item)),
  )].slice(0, 3);
  return tags.length > 0 ? tags : ['other'];
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
    '- If unsure, use other.',
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
