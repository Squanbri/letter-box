import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { ImapService } from '../mail/imap.service';
import { DatabaseService } from '../database/database.service';
import { AccountService, SaveAccountInput } from './account.service';

@Controller('account')
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(ImapService) private readonly imap: ImapService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get()
  getStatus(): { configured: boolean; email: string | null; provider: string | null } {
    return this.accounts.status();
  }

  @Post()
  async save(@Body() input: SaveAccountInput): Promise<{
    configured: true;
    email: string;
    provider: string;
  }> {
    const previous = this.accounts.getAccount();
    const account = this.accounts.prepare(input);
    this.accounts.use(account);

    try {
      await this.imap.testConnection();
      await this.accounts.persist(account);
      if (
        previous?.email !== account.email
        || previous?.provider !== account.provider
      ) {
        this.database.clearMailData();
      }
    } catch (error) {
      this.accounts.use(previous);
      throw error;
    }

    return {
      configured: true,
      email: account.email,
      provider: account.provider,
    };
  }
}
