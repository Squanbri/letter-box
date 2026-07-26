import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@letter-box/contracts';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => (
    context.switchToHttp().getRequest<AuthenticatedRequest>().user
  ),
);
