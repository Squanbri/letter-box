import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { inspect } from 'node:util';
import { dirname } from 'node:path';

const MAX_LOG_SIZE = 2 * 1024 * 1024;

export function installFileLogger(logPath: string): void {
  mkdirSync(dirname(logPath), { recursive: true });
  rotateIfNeeded(logPath);

  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      original(...values);
      append(logPath, level, values);
    };
  }

  process.on('uncaughtException', (error) => {
    console.error('Необработанная ошибка main process', error);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Необработанный rejected promise', reason);
  });

  console.info('Логирование запущено', {
    version: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
  });
}

function append(logPath: string, level: string, values: unknown[]): void {
  try {
    const message = values
      .map((value) => typeof value === 'string' ? value : inspect(value, { depth: 5 }))
      .join(' ');
    appendFileSync(
      logPath,
      `${new Date().toISOString()} [${level.toUpperCase()}] ${message}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  } catch {
    // Logging must never crash the app.
  }
}

function rotateIfNeeded(logPath: string): void {
  try {
    if (statSync(logPath).size >= MAX_LOG_SIZE) {
      renameSync(logPath, `${logPath}.previous`);
    }
  } catch {
    // The log does not exist yet.
  }
}

