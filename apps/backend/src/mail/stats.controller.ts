import {
  Controller,
  DefaultValuePipe,
  Get,
  Inject,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import type { AuthUser, DashboardStats } from '@letter-box/contracts';
import { CurrentUser } from '../auth/current-user.decorator';
import { MailService } from './mail.service';

@Controller('stats')
export class StatsController {
  constructor(@Inject(MailService) private readonly mail: MailService) {}

  @Get()
  dashboard(
    @CurrentUser() user: AuthUser,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days = 30,
    @Query('mailbox') mailbox = 'INBOX',
  ): Promise<DashboardStats> {
    return this.mail.dashboardStats(user.id, days, mailbox);
  }
}
