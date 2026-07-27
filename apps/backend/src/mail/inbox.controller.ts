import {
  Controller,
  DefaultValuePipe,
  Get,
  Inject,
  ParseBoolPipe,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import type { AuthUser, MessageRecord } from '@letter-box/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import { MailService } from './mail.service';

@Controller('inbox')
export class InboxController {
  constructor(@Inject(MailService) private readonly mail: MailService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('mailbox') mailbox = 'INBOX',
    @Query('tag') tag?: string,
    @Query('unread', new DefaultValuePipe(false), ParseBoolPipe) unread = false,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ): Promise<MessageRecord[]> {
    return this.mail.listInbox(user.id, {
      mailbox,
      tag: tag?.trim() || undefined,
      unreadOnly: unread,
      limit,
      offset,
    });
  }
}
