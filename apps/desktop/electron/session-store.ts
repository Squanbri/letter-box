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
