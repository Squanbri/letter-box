import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MailService, SyncResult } from './mail.service';
import { MessageRecord } from './mail.types';

@Controller('accounts/:accountId')
export class MailController {
  constructor(@Inject(MailService) private readonly mail: MailService) {}

  @Post('imap/connect')
  connect(@Param('accountId') accountId: string): Promise<{ connected: true }> {
    return this.mail.connect(accountId);
  }

  @Post('mail/sync')
  sync(@Param('accountId') accountId: string): Promise<SyncResult> {
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
