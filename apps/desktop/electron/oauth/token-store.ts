import { app, safeStorage } from 'electron';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { AuthResult } from './types';

interface StoredToken {
  email: string;
  providerId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

type TokenMap = Record<string, StoredToken>;

const tokensPath = () => join(app.getPath('userData'), 'mail-tokens.bin');

export class TokenStore {
  save(key: string, result: AuthResult, providerId: string): void {
    if (result.type !== 'oauth' || !result.accessToken || !result.refreshToken || !result.expiresAt) {
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Системное шифрование токенов недоступно');
    }
    const stored = this.loadAll();
    stored[key] = {
      email: result.email,
      providerId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
    };
    this.write(stored);
  }

  delete(key: string): void {
    const stored = this.loadAll();
    if (!(key in stored)) return;
    delete stored[key];
    this.write(stored);
  }

  load(key: string): StoredToken | null {
    return this.loadAll()[key] ?? null;
  }

  private loadAll(): TokenMap {
    const path = tokensPath();
    if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return {};
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(path))) as TokenMap;
    } catch {
      return {};
    }
  }

  private write(stored: TokenMap): void {
    const path = tokensPath();
    mkdirSync(dirname(path), { recursive: true });
    if (Object.keys(stored).length === 0) {
      if (existsSync(path)) unlinkSync(path);
      return;
    }
    const temporaryPath = `${path}.tmp`;
    writeFileSync(temporaryPath, safeStorage.encryptString(JSON.stringify(stored)), { mode: 0o600 });
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  }
}

export const tokenStore = new TokenStore();
