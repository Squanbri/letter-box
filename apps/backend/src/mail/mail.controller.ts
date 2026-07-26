import { Controller, Get, Inject, Param, ParseIntPipe, Post } from '@nestjs/common';
import { MailService } from './mail.service';
import { MessageRecord } from './mail.types';

@Controller()
export class MailController {
  constructor(@Inject(MailService) private readonly mail: MailService) {}

  @Post('imap/connect')
  connect(): Promise<{ connected: true }> {
    return this.mail.connect();
  }

  @Post('mail/sync')
  sync(): Promise<{ synced: number }> {
    return this.mail.syncInbox();
  }

  @Get('messages')
  list(): MessageRecord[] {
    return this.mail.listMessages();
  }

  @Get('messages/:uid')
  get(@Param('uid', ParseIntPipe) uid: number): Promise<MessageRecord> {
    return this.mail.getMessage(uid);
  }
}
