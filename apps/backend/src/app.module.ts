import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health.controller';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { DiagnosticsController } from './diagnostics.controller';
import { ImapService } from './mail/imap.service';
import { MailController } from './mail/mail.controller';
import { MailService } from './mail/mail.service';
import { SmtpService } from './mail/smtp.service';
import { EventsGateway } from './events/events.gateway';
import { PrismaAccountRepository } from './account/prisma-account.repository';
import { PrismaMailRepository } from './mail/prisma-mail.repository';
import {
  ACCOUNT_REPOSITORY,
  MAIL_REPOSITORY,
} from './database/repository.contracts';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { PrismaAuthRepository } from './auth/prisma-auth.repository';
import { AUTH_REPOSITORY } from './auth/auth.contract';
import { AccountOwnershipGuard } from './auth/account-ownership.guard';
import { SyncQueueService } from './sync/sync-queue.service';
import { PrismaDatabaseService } from './database/prisma-database.service';
import { OllamaService } from './ai/ollama.service';
import { ClassificationService } from './ai/classification.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret && process.env.NODE_ENV === 'production') {
          throw new Error('JWT_SECRET is required in production');
        }
        return { secret: secret ?? 'letter-box-development-jwt-secret' };
      },
    }),
    ThrottlerModule.forRoot([{
      ttl: 60_000,
      limit: 10,
    }]),
  ],
  controllers: [
    HealthController,
    DiagnosticsController,
    AccountController,
    MailController,
    AuthController,
  ],
  providers: [
    AccountService,
    PrismaAccountRepository,
    PrismaDatabaseService,
    ImapService,
    SmtpService,
    MailService,
    PrismaMailRepository,
    AuthService,
    AccountOwnershipGuard,
    PrismaAuthRepository,
    {
      provide: ACCOUNT_REPOSITORY,
      useExisting: PrismaAccountRepository,
    },
    {
      provide: MAIL_REPOSITORY,
      useExisting: PrismaMailRepository,
    },
    {
      provide: AUTH_REPOSITORY,
      useExisting: PrismaAuthRepository,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    EventsGateway,
    SyncQueueService,
    OllamaService,
    ClassificationService,
  ],
})
export class AppModule {}
