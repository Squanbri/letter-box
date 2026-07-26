import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AuthCredentials,
  AuthSession,
  AuthUser,
  RefreshSessionInput,
} from '@letter-box/contracts';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { AUTH_REPOSITORY, AuthRepositoryContract } from './auth.contract';

const scrypt = promisify(nodeScrypt);

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepositoryContract,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async register(input: AuthCredentials): Promise<AuthSession> {
    const credentials = this.validate(input);
    const result = await this.repository.register({
      id: randomUUID(),
      email: credentials.email,
      passwordHash: await this.hash(credentials.password),
    }, new Date().toISOString(), process.env.ALLOW_REGISTRATION === 'true');
    if (result.status === 'disabled') {
      throw new ForbiddenException('Регистрация новых пользователей отключена');
    }
    if (result.status === 'email-exists') {
      throw new ConflictException('Пользователь с таким email уже существует');
    }
    return this.session(result.user);
  }

  async login(input: AuthCredentials): Promise<AuthSession> {
    const credentials = this.validate(input);
    const stored = await this.repository.findByEmail(credentials.email);
    if (!stored || !await this.verify(credentials.password, stored.passwordHash)) {
      throw new UnauthorizedException('Неверный email или пароль');
    }
    return this.session({ id: stored.id, email: stored.email });
  }

  async refresh(input: RefreshSessionInput): Promise<AuthSession> {
    if (typeof input?.refreshToken !== 'string' || input.refreshToken.length < 32) {
      throw new UnauthorizedException('Refresh token недействителен');
    }
    const next = this.refreshToken();
    const user = await this.repository.rotateSession(
      this.tokenHash(input.refreshToken),
      next.stored,
    );
    if (!user) throw new UnauthorizedException('Refresh token недействителен или истёк');
    return this.buildSession(user, next.raw);
  }

  async logout(userId: string, input: RefreshSessionInput): Promise<void> {
    if (typeof input?.refreshToken !== 'string') return;
    await this.repository.revokeSession(userId, this.tokenHash(input.refreshToken));
  }

  private async session(user: AuthUser): Promise<AuthSession> {
    const refresh = this.refreshToken();
    await this.repository.createSession(
      refresh.stored.id,
      user.id,
      refresh.stored.tokenHash,
      refresh.stored.expiresAt,
      refresh.stored.createdAt,
    );
    return this.buildSession(user, refresh.raw);
  }

  private async buildSession(user: AuthUser, refreshToken: string): Promise<AuthSession> {
    return {
      accessToken: await this.jwt.signAsync(
        { email: user.email },
        { subject: user.id, expiresIn: '15m' },
      ),
      refreshToken,
      user,
    };
  }

  private refreshToken() {
    const raw = randomBytes(32).toString('base64url');
    const createdAt = new Date();
    return {
      raw,
      stored: {
        id: randomUUID(),
        tokenHash: this.tokenHash(raw),
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    };
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private validate(input: AuthCredentials): AuthCredentials {
    const email = input?.email?.trim().toLowerCase();
    const password = input?.password;
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('Укажите корректный email');
    }
    if (typeof password !== 'string' || password.length < 10) {
      throw new BadRequestException('Пароль должен содержать не менее 10 символов');
    }
    return { email, password };
  }

  private async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, 64) as Buffer;
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  private async verify(password: string, encoded: string): Promise<boolean> {
    const [algorithm, saltHex, hashHex] = encoded.split('$');
    if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
