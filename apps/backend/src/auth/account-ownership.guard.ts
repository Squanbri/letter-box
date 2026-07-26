import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import type { AuthenticatedRequest } from './current-user.decorator';

@Injectable()
export class AccountOwnershipGuard implements CanActivate {
  constructor(@Inject(AccountService) private readonly accounts: AccountService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accountId = request.params.accountId;
    if (typeof accountId !== 'string') return false;
    await this.accounts.get(accountId, request.user.id);
    return true;
  }
}
