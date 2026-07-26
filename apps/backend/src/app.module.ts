import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { DiagnosticsController } from './diagnostics.controller';
import { DatabaseService } from './database/database.service';
import { ImapService } from './mail/imap.service';
import { MailController } from './mail/mail.controller';
import { MailService } from './mail/mail.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
  ],
  controllers: [
    HealthController,
    DiagnosticsController,
    AccountController,
    MailController,
  ],
  providers: [AccountService, DatabaseService, ImapService, MailService],
})
export class AppModule {}
