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

const sessionPath = () => join(app.getPath('userData'), 'auth-session.bin');

export function loadSession(): string | null {
  const path = sessionPath();
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(readFileSync(path));
}

export interface DesktopAuthSession {
  accessToken: string;
  refreshToken: string;
  user?: { id: string; email: string };
}

export function readAuthSession(): DesktopAuthSession | null {
  const raw = loadSession();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DesktopAuthSession;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function accessTokenNeedsRefresh(token: string, skewMs = 60_000): boolean {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { exp?: number };
    return !payload.exp || payload.exp * 1000 < Date.now() + skewMs;
  } catch {
    return true;
  }
}

export function saveSession(value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Системное шифрование desktop-сессии недоступно');
  }
  const path = sessionPath();
  const temporaryPath = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporaryPath, safeStorage.encryptString(value), { mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}

export function clearSession(): void {
  const path = sessionPath();
  if (existsSync(path)) unlinkSync(path);
}
