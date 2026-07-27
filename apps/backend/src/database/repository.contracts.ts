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
  find(userId: string | null, accountId: string): Promise<AccountRow | undefined>;
  saveConnected(account: AccountConfig, userId: string | null, now: string): Promise<void>;
  setStatus(
    accountId: string,
    status: AccountStatus['status'],
    error: string | null,
    now: string,
  ): Promise<void>;
  markSynced(accountId: string, now: string): Promise<void>;
  remove(userId: string | null, accountId: string): Promise<void>;
  clearMailData(accountId: string): Promise<void>;
}

export interface MailRepositoryContract {
  mailboxState(accountId: string, mailbox: string): Promise<string | undefined>;
  knownUids(accountId: string, mailbox: string): Promise<number[]>;
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
    body: { text: string | null; html: string | null },
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
