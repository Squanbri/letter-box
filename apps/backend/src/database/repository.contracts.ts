import type { AccountStatus, MailboxRecord } from '@letter-box/contracts';
import type { AccountConfig } from '../runtime';
import type { AccountRow } from '../account/account.types';
import type {
  ClassificationPreparation,
  MailboxChanges,
  MessageMetadata,
  MessageRow,
} from '../mail/mail.types';

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');
export const MAIL_REPOSITORY = Symbol('MAIL_REPOSITORY');

export interface AccountRepositoryContract {
  resetConnectionStatuses(now: string): Promise<void>;
  upsertStored(account: AccountConfig, now: string): Promise<void>;
  list(userId: string | null): Promise<AccountRow[]>;
  listAll(): Promise<AccountRow[]>;
  find(userId: string | null, accountId: string): Promise<AccountRow | undefined>;
  saveConnected(account: AccountConfig, userId: string | null, now: string): Promise<void>;
  setStatus(
    accountId: string,
    status: AccountStatus['status'],
    error: string | null,
    now: string,
  ): Promise<void>;
  markSynced(accountId: string, now: string): Promise<void>;
  recordSyncFailure(
    accountId: string,
    error: string,
    backoffUntil: string,
    failCount: number,
    now: string,
  ): Promise<void>;
  clearSyncBackoff(accountId: string, now: string): Promise<void>;
  getSyncBackoff(
    accountId: string,
  ): Promise<{ failCount: number; backoffUntil: string | null } | undefined>;
  remove(userId: string | null, accountId: string): Promise<void>;
  clearMailData(accountId: string): Promise<void>;
}

export interface MailRepositoryContract {
  mailboxState(accountId: string, mailbox: string): Promise<string | undefined>;
  knownUids(accountId: string, mailbox: string): Promise<number[]>;
  folderCursor(
    accountId: string,
    mailbox: string,
  ): Promise<FolderCursor | undefined>;
  setFolderCursor(
    accountId: string,
    mailbox: string,
    cursor: FolderCursorUpdate,
  ): Promise<void>;
  applyChanges(
    accountId: string,
    mailbox: string,
    changes: MailboxChanges,
  ): Promise<number>;
  listMessages(
    accountId: string,
    mailbox: string,
    limit: number,
    offset: number,
    tag?: string,
  ): Promise<MessageRow[]>;
  listInbox(
    accountIds: string[],
    options: {
      mailbox: string;
      limit: number;
      offset: number;
      unreadOnly?: boolean;
      tag?: string;
    },
  ): Promise<MessageRow[]>;
  listMailboxes(accountId: string): Promise<MailboxRecord[]>;
  replaceMailboxes(accountId: string, mailboxes: MailboxRecord[]): Promise<void>;
  saveMessages(
    accountId: string,
    mailbox: string,
    messages: MessageMetadata[],
  ): Promise<void>;
  findMessage(
    accountId: string,
    mailbox: string,
    uid: number,
  ): Promise<MessageRow | undefined>;
  listThread(accountId: string, threadId: string): Promise<MessageRow[]>;
  tagCounts(
    accountId: string,
    mailbox: string,
  ): Promise<Array<{ tag: string; count: number }>>;
  messagesByDay(
    accountIds: string[],
    mailbox: string,
    since: Date,
  ): Promise<Array<{ accountId: string; date: string; count: number }>>;
  messagesByTag(
    accountIds: string[],
    mailbox: string,
    unreadOnly?: boolean,
  ): Promise<Array<{ tag: string; count: number }>>;
  messagesByTagByAccount(
    accountIds: string[],
    mailbox: string,
  ): Promise<Array<{
    tag: string;
    accountId: string;
    count: number;
    unreadCount: number;
  }>>;
  awaitingReply(
    accountIds: string[],
    mailbox: string,
    limit?: number,
  ): Promise<Array<{
    accountId: string;
    mailbox: string;
    uid: number;
    subject: string | null;
    fromName: string | null;
    fromAddress: string | null;
    date: string;
  }>>;
  messageTotals(
    accountIds: string[],
    mailbox: string,
  ): Promise<{ total: number; classified: number }>;
  classificationCandidateUids(accountId: string, mailbox: string): Promise<number[]>;
  saveClassificationPreparations(
    accountId: string,
    mailbox: string,
    preparations: ClassificationPreparation[],
  ): Promise<void>;
  saveBody(
    accountId: string,
    mailbox: string,
    uid: number,
    body: {
      text: string | null;
      html: string | null;
      messageId?: string | null;
      inReplyTo?: string | null;
      references?: string[];
      threadId?: string | null;
    },
    loadedAt: string,
  ): Promise<void>;
  saveFlags(
    accountId: string,
    mailbox: string,
    uid: number,
    flags: string[],
  ): Promise<void>;
  hasMailbox(accountId: string, mailbox: string): Promise<boolean>;
  specialMailbox(accountId: string, specialUse: string): Promise<string | undefined>;
  removeMessage(accountId: string, mailbox: string, uid: number): Promise<void>;
}

export interface FolderCursor {
  uidValidity: string | null;
  lastSeenUid: number | null;
  /** null = not started; 0 = complete; >0 = resume before this UID. */
  backfilledUid: number | null;
}

export interface FolderCursorUpdate {
  uidValidity?: string | null;
  lastSeenUid?: number | null;
  backfilledUid?: number | null;
}
