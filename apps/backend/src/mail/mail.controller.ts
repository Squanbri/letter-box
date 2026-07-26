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
} from '@nestjs/common';
import { MailService, SyncResult } from './mail.service';
import { MailboxRecord, MessageRecord } from './mail.types';

@Controller('accounts/:accountId')
export class MailController {
  constructor(@Inject(MailService) private readonly mail: MailService) {}

  @Post('imap/connect')
  connect(@Param('accountId') accountId: string): Promise<{ connected: true }> {
    return this.mail.connect(accountId);
  }

  @Post('mail/sync')
  sync(
    @Param('accountId') accountId: string,
    @Query('mailbox') mailbox = 'INBOX',
  ): Promise<SyncResult> {
    return this.mail.syncMailbox(accountId, mailbox);
  }

  @Get('mailboxes')
  mailboxes(@Param('accountId') accountId: string): MailboxRecord[] {
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
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ): MessageRecord[] {
    return this.mail.listMessages(accountId, mailbox, limit, offset);
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
}
