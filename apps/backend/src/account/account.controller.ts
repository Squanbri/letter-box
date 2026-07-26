import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { ImapService } from '../mail/imap.service';
import { DatabaseService } from '../database/database.service';
import { AccountService, AccountStatus, SaveAccountInput } from './account.service';

@Controller('accounts')
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(ImapService) private readonly imap: ImapService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get()
  list(): AccountStatus[] {
    return this.accounts.list();
  }

  @Post()
  create(@Body() input: SaveAccountInput): Promise<AccountStatus> {
    return this.saveAndTest(this.accounts.prepare(input));
  }

  @Put(':accountId')
  reconnect(
    @Param('accountId') accountId: string,
    @Body() input: SaveAccountInput,
  ): Promise<AccountStatus> {
    this.accounts.get(accountId);
    return this.saveAndTest(this.accounts.prepare(input, accountId), true);
  }

  @Delete(':accountId')
  async remove(@Param('accountId') accountId: string): Promise<{ deleted: true }> {
    await this.accounts.remove(accountId);
    return { deleted: true };
  }

  private async saveAndTest(
    account: ReturnType<AccountService['prepare']>,
    clearData = false,
  ): Promise<AccountStatus> {
    let previous: ReturnType<AccountService['getConfig']> | undefined;
    try { previous = this.accounts.getConfig(account.id); } catch { /* new account */ }
    this.accounts.use(account);
    try {
      await this.imap.testConnection(account.id);
      await this.accounts.persist(account);
      if (clearData) this.database.clearAccountData(account.id);
      return this.accounts.get(account.id);
    } catch (error) {
      if (previous) this.accounts.use(previous);
      throw error;
    }
  }
}
