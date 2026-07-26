import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { ImapService } from '../mail/imap.service';
import { AccountService, AccountStatus, SaveAccountInput } from './account.service';
import type { AuthUser } from '@letter-box/contracts';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('accounts')
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(ImapService) private readonly imap: ImapService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AccountStatus[]> {
    return this.accounts.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() input: SaveAccountInput,
  ): Promise<AccountStatus> {
    return this.saveAndTest(user.id, this.accounts.prepare(input));
  }

  @Put(':accountId')
  async reconnect(
    @Param('accountId') accountId: string,
    @CurrentUser() user: AuthUser,
    @Body() input: SaveAccountInput,
  ): Promise<AccountStatus> {
    await this.accounts.get(accountId, user.id);
    return this.saveAndTest(user.id, this.accounts.prepare(input, accountId), true);
  }

  @Delete(':accountId')
  async remove(
    @Param('accountId') accountId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ deleted: true }> {
    await this.accounts.remove(accountId, user.id);
    return { deleted: true };
  }

  private async saveAndTest(
    userId: string,
    account: ReturnType<AccountService['prepare']>,
    clearData = false,
  ): Promise<AccountStatus> {
    let previous: ReturnType<AccountService['getConfig']> | undefined;
    try { previous = this.accounts.getConfig(account.id); } catch { /* new account */ }
    this.accounts.use(account);
    try {
      await this.imap.testConnection(account.id);
      await this.accounts.persist(account, userId);
      if (clearData) await this.accounts.clearMailData(account.id);
      return await this.accounts.get(account.id, userId);
    } catch (error) {
      if (previous) this.accounts.use(previous);
      throw error;
    }
  }
}
