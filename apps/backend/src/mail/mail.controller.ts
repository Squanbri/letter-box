import {
  Body,
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { MailService, SyncResult } from './mail.service';
import { MailboxRecord, MessageRecord } from './mail.types';
import { AccountOwnershipGuard } from '../auth/account-ownership.guard';
import { SyncQueueService } from '../sync/sync-queue.service';
import type { SendMessageInput, SendMessageResult, SyncStatus } from '@letter-box/contracts';

@UseGuards(AccountOwnershipGuard)
@Controller('accounts/:accountId')
export class MailController {
  constructor(
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SyncQueueService) private readonly syncQueue: SyncQueueService,
  ) {}

  @Post('imap/connect')
  async connect(
    @Param('accountId') accountId: string,
  ): Promise<{ connected: true }> {
    const result = await this.mail.connect(accountId);
    // Incremental first; worker chains history backfill when sync completes.
    void this.syncQueue.enqueueSync(accountId, 'INBOX').catch(() => undefined);
    return result;
  }

  @Post('mail/sync')
  sync(
    @Param('accountId') accountId: string,
    @Query('mailbox') mailbox = 'INBOX',
  ): Promise<SyncResult> {
    return this.syncQueue.enqueueAndWait(accountId, mailbox);
  }

  @Post('mail/backfill')
  backfill(
    @Param('accountId') accountId: string,
    @Query('mailbox') mailbox = 'INBOX',
    @Query('force') force?: string,
  ): Promise<{ queued: boolean }> {
    return this.syncQueue.enqueueBackfill(accountId, mailbox, {
      force: force === '1' || force === 'true',
    });
  }

  @Get('mail/sync')
  syncStatus(@Param('accountId') accountId: string): Promise<SyncStatus> {
    return this.syncQueue.status(accountId);
  }

  @Get('mailboxes')
  mailboxes(@Param('accountId') accountId: string): Promise<MailboxRecord[]> {
    return this.mail.listMailboxes(accountId);
  }

  @Post('mailboxes/sync')
  syncMailboxes(@Param('accountId') accountId: string): Promise<MailboxRecord[]> {
    return this.mail.syncMailboxes(accountId);
  }

  @Get('messages')
  list(
    @Param('accountId') accountId: string,
    @Query('mailbox') mailbox = 'INBOX',
    @Query('tag') tag?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ): Promise<MessageRecord[]> {
    return this.mail.listMessages(accountId, mailbox, limit, offset, tag?.trim() || undefined);
  }

  @Post('messages/send')
  send(
    @Param('accountId') accountId: string,
    @Body() input: SendMessageInput,
  ): Promise<SendMessageResult> {
    return this.mail.sendMessage(accountId, input);
  }

  @Get('mail/tags')
  tags(
    @Param('accountId') accountId: string,
    @Query('mailbox') mailbox = 'INBOX',
  ): Promise<Array<{ tag: string; count: number }>> {
    return this.mail.tagCounts(accountId, mailbox);
  }

  @Post('mail/load-older')
  loadOlder(
    @Param('accountId') accountId: string,
    @Query('mailbox') mailbox = 'INBOX',
    @Query('beforeUid') beforeUid?: string,
  ): Promise<{ loaded: number }> {
    const parsedUid = beforeUid === undefined ? undefined : Number(beforeUid);
    if (parsedUid !== undefined && (!Number.isInteger(parsedUid) || parsedUid <= 0)) {
      throw new BadRequestException('beforeUid должен быть положительным UID');
    }
    return this.mail.loadOlder(accountId, mailbox, parsedUid);
  }

  @Get('messages/:uid')
  get(
    @Param('accountId') accountId: string,
    @Param('uid', ParseIntPipe) uid: number,
    @Query('mailbox') mailbox = 'INBOX',
  ): Promise<MessageRecord> {
    return this.mail.getMessage(accountId, mailbox, uid);
  }

  @Get('messages/:uid/thread')
  thread(
    @Param('accountId') accountId: string,
    @Param('uid', ParseIntPipe) uid: number,
    @Query('mailbox') mailbox = 'INBOX',
  ): Promise<MessageRecord[]> {
    return this.mail.listThread(accountId, mailbox, uid);
  }

  @Patch('messages/:uid/seen')
  setSeen(
    @Param('accountId') accountId: string,
    @Param('uid', ParseIntPipe) uid: number,
    @Query('mailbox') mailbox = 'INBOX',
    @Body() input: { seen: boolean },
  ): Promise<MessageRecord> {
    if (typeof input.seen !== 'boolean') {
      throw new BadRequestException('Поле seen должно быть boolean');
    }
    return this.mail.setSeen(accountId, mailbox, uid, input.seen);
  }

  @Patch('messages/:uid/flagged')
  setFlagged(
    @Param('accountId') accountId: string,
    @Param('uid', ParseIntPipe) uid: number,
    @Query('mailbox') mailbox = 'INBOX',
    @Body() input: { flagged: boolean },
  ): Promise<MessageRecord> {
    if (typeof input.flagged !== 'boolean') {
      throw new BadRequestException('Поле flagged должно быть boolean');
    }
    return this.mail.setFlagged(accountId, mailbox, uid, input.flagged);
  }

  @Post('messages/:uid/move')
  move(
    @Param('accountId') accountId: string,
    @Param('uid', ParseIntPipe) uid: number,
    @Query('mailbox') mailbox = 'INBOX',
    @Body() input: { destination: string },
  ): Promise<{ moved: true }> {
    if (typeof input.destination !== 'string' || !input.destination.trim()) {
      throw new BadRequestException('Укажите папку назначения');
    }
    return this.mail.moveMessage(accountId, mailbox, uid, input.destination);
  }

  @Post('messages/:uid/archive')
  archive(
    @Param('accountId') accountId: string,
    @Param('uid', ParseIntPipe) uid: number,
    @Query('mailbox') mailbox = 'INBOX',
  ): Promise<{ moved: true }> {
    return this.mail.archiveMessage(accountId, mailbox, uid);
  }

  @Delete('messages/:uid')
  remove(
    @Param('accountId') accountId: string,
    @Param('uid', ParseIntPipe) uid: number,
    @Query('mailbox') mailbox = 'INBOX',
  ): Promise<{ deleted: true }> {
    return this.mail.deleteMessage(accountId, mailbox, uid);
  }
}
