import { Controller, Get, Inject, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { MailService } from './mail.service';
import { MessageRecord } from './mail.types';

@Controller('accounts/:accountId')
export class MailController {
  constructor(@Inject(MailService) private readonly mail: MailService) {}

  @Post('imap/connect')
  connect(@Param('accountId') accountId: string): Promise<{ connected: true }> {
    return this.mail.connect(accountId);
  }

  @Post('mail/sync')
  sync(@Param('accountId') accountId: string): Promise<{ synced: number }> {
    return this.mail.syncInbox(accountId);
  }

  @Get('messages')
  list(
    @Param('accountId') accountId: string,
    @Query('mailbox') mailbox = 'INBOX',
  ): MessageRecord[] {
    return this.mail.listMessages(accountId, mailbox);
  }

  @Get('messages/:uid')
  get(
    @Param('accountId') accountId: string,
    @Param('uid', ParseIntPipe) uid: number,
    @Query('mailbox') mailbox = 'INBOX',
  ): Promise<MessageRecord> {
    return this.mail.getMessage(accountId, mailbox, uid);
  }
}
