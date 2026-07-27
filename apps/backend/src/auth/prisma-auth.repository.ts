import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@letter-box/contracts';
import { PrismaDatabaseService } from '../database/prisma-database.service';
import type { RegistrationResult, StoredUser } from './auth.contract';

@Injectable()
export class PrismaAuthRepository {
  constructor(private readonly database: PrismaDatabaseService) {}

  count(): Promise<number> {
    return this.database.client.user.count();
  }

  async findByEmail(email: string): Promise<StoredUser | undefined> {
    const user = await this.database.client.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
    return user ?? undefined;
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const user = await this.database.client.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    return user ?? undefined;
  }

  async create(user: StoredUser, now: string): Promise<AuthUser> {
    return this.database.client.user.create({
      data: {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
      select: { id: true, email: true },
    });
  }

  async claimUnownedAccounts(userId: string): Promise<void> {
    await this.database.client.account.updateMany({
      where: { userId: null },
      data: { userId },
    });
  }

  async register(
    user: StoredUser,
    now: string,
    allowRegistration: boolean,
  ): Promise<RegistrationResult> {
    return this.database.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE',
      );
      if (await transaction.user.findUnique({
        where: { email: user.email },
        select: { id: true },
      })) return { status: 'email-exists' };

      const count = await transaction.user.count();
      if (count > 0 && !allowRegistration) return { status: 'disabled' };
      const created = await transaction.user.create({
        data: {
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        },
        select: { id: true, email: true },
      });
      if (count === 0) {
        await transaction.account.updateMany({
          where: { userId: null },
          data: { userId: user.id },
        });
      }
      return { status: 'created', user: created };
    });
  }

  async createSession(
    id: string,
    userId: string,
    tokenHash: string,
    expiresAt: string,
    createdAt: string,
  ): Promise<void> {
    await this.database.client.authSession.create({
      data: {
        id,
        userId,
        tokenHash,
        expiresAt: new Date(expiresAt),
        createdAt: new Date(createdAt),
      },
    });
  }

  async rotateSession(
    currentHash: string,
    next: {
      id: string;
      tokenHash: string;
      expiresAt: string;
      createdAt: string;
    },
  ): Promise<AuthUser | undefined> {
    return this.database.client.$transaction(async (transaction) => {
      const session = await transaction.authSession.findFirst({
        where: {
          tokenHash: currentHash,
          expiresAt: { gt: new Date(next.createdAt) },
        },
        select: { user: { select: { id: true, email: true } } },
      });
      if (!session) return undefined;
      const deletion = await transaction.authSession.deleteMany({
        where: {
          tokenHash: currentHash,
          expiresAt: { gt: new Date(next.createdAt) },
        },
      });
      if (deletion.count !== 1) return undefined;
      await transaction.authSession.create({
        data: {
          id: next.id,
          userId: session.user.id,
          tokenHash: next.tokenHash,
          expiresAt: new Date(next.expiresAt),
          createdAt: new Date(next.createdAt),
        },
      });
      return session.user;
    });
  }

  async revokeSession(userId: string, tokenHash: string): Promise<void> {
    await this.database.client.authSession.deleteMany({
      where: { userId, tokenHash },
    });
  }
}
