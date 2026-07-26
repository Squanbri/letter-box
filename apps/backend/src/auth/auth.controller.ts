import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  SkipThrottle,
  Throttle,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  AuthCredentials,
  AuthSession,
  AuthUser,
  RefreshSessionInput,
} from '@letter-box/contracts';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  register(@Body() input: AuthCredentials): Promise<AuthSession> {
    return this.auth.register(input);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() input: AuthCredentials): Promise<AuthSession> {
    return this.auth.login(input);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() input: RefreshSessionInput): Promise<AuthSession> {
    return this.auth.refresh(input);
  }

  @Post('logout')
  @HttpCode(204)
  @SkipThrottle()
  async logout(
    @CurrentUser() user: AuthUser,
    @Body() input: RefreshSessionInput,
  ): Promise<void> {
    await this.auth.logout(user.id, input);
  }
}
