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
}

export interface MessageFlags {
  uid: number;
  flags: string[];
}

export interface MailboxChanges {
  uidValidity: string;
  reset: boolean;
  serverUids: number[];
  messages: MessageMetadata[];
  flagUpdates: MessageFlags[];
}
