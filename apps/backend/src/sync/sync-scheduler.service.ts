import { Inject, Injectable, Logger } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import {
  MAIL_REPOSITORY,
  MailRepositoryContract,
} from '../database/repository.contracts';
import { MailboxFolderLock } from './mailbox-folder.lock';
import { SyncQueueService } from './sync-queue.service';

@Injectable()
export class SyncSchedulerService {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(MAIL_REPOSITORY) private readonly mail: MailRepositoryContract,
    @Inject(SyncQueueService) private readonly syncQueue: SyncQueueService,
    @Inject(MailboxFolderLock) private readonly locks: MailboxFolderLock,
  ) {}

  async tickInbox(): Promise<{ enqueued: number; skipped: number }> {
    return this.tickAccounts(async (accountId) => {
      const result = await this.syncQueue.enqueueSync(accountId, 'INBOX');
      return result.queued ? 1 : 0;
    });
  }

  async tickFolders(): Promise<{ enqueued: number; skipped: number }> {
    return this.tickAccounts(async (accountId) => {
      const mailboxes = await this.mail.listMailboxes(accountId);
      let enqueued = 0;
      for (const mailbox of mailboxes) {
        if (mailbox.path.toUpperCase() === 'INBOX') continue;
        const result = await this.syncQueue.enqueueSync(accountId, mailbox.path);
        if (result.queued) enqueued += 1;
      }
      return enqueued;
    });
  }

  private async tickAccounts(
    enqueueForAccount: (accountId: string) => Promise<number>,
  ): Promise<{ enqueued: number; skipped: number }> {
    const accounts = await this.accounts.listAll();
    let enqueued = 0;
    let skipped = 0;

    for (const account of accounts) {
      if (!this.accounts.hasCredentials(account.id)) {
        skipped += 1;
        continue;
      }
      if (await this.accounts.isSyncBackoffActive(account.id)) {
        const remaining = await this.accounts.getSyncBackoffRemainingMs(account.id);
        this.logger.warn(
          `skip account ${account.id} (${account.email}): backoff ${remaining}ms; lastError=${account.lastError ?? 'n/a'}`,
        );
        skipped += 1;
        continue;
      }
      if (await this.locks.isAccountLocked(account.id)) {
        this.logger.log(
          `skip account ${account.id} (${account.email}): sync already in flight`,
        );
        skipped += 1;
        continue;
      }

      try {
        enqueued += await enqueueForAccount(account.id);
      } catch (error) {
        skipped += 1;
        this.logger.error(
          `failed to enqueue sync for ${account.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    return { enqueued, skipped };
  }
}
