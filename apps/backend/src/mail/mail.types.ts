export type {
  MailboxRecord,
  MessageRecord,
} from '@letter-box/contracts';

export interface MessageMetadata {
  uid: number;
  subject: string | null;
  senderName: string | null;
  senderAddress: string | null;
  date: string;
  flags: string[];
  size: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  threadId: string | null;
}

export interface MessageFlags {
  uid: number;
  flags: string[];
}

export type ClassificationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ClassificationPreparation {
  uid: number;
  text: string | null;
  status: 'pending' | 'failed';
}

export interface MailboxChanges {
  uidValidity: string;
  reset: boolean;
  serverUids: number[];
  messages: MessageMetadata[];
  flagUpdates: MessageFlags[];
  classificationPreparations: ClassificationPreparation[];
}

export interface MessageRow {
  account_id: string;
  mailbox: string;
  uid: number;
  subject: string | null;
  sender_name: string | null;
  sender_address: string | null;
  received_at: string;
  flags: string;
  size: number;
  body_text: string | null;
  body_html: string | null;
  body_loaded_at: string | null;
  classification_text: string | null;
  classification_status: ClassificationStatus;
  classified_at: string | null;
  tags: string[];
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  thread_id: string | null;
}

export function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/<[^>]+>/);
  return (match?.[0] ?? trimmed).toLowerCase();
}

export function parseMessageIds(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(' ') : value;
  const ids = raw.match(/<[^>]+>/g) ?? (raw.trim() ? [raw.trim()] : []);
  const unique = new Set<string>();
  for (const id of ids) {
    const normalized = normalizeMessageId(id);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

export function computeThreadId(
  messageId: string | null | undefined,
  inReplyTo: string | null | undefined,
  references: string[] | string | null | undefined,
): string | null {
  const refs = parseMessageIds(references);
  if (refs.length > 0) return refs[0] ?? null;
  return normalizeMessageId(inReplyTo) ?? normalizeMessageId(messageId);
}

export function serializeReferences(ids: string[]): string | null {
  return ids.length > 0 ? ids.join(' ') : null;
}
