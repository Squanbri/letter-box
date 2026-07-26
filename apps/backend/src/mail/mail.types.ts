export interface MessageRecord {
  accountId: string;
  mailbox: string;
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

export interface MailboxRecord {
  path: string;
  name: string;
  delimiter: string;
  specialUse: string | null;
  totalCount: number;
  unreadCount: number;
}
