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
