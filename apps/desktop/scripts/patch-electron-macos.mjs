#!/usr/bin/env node
/**
 * Dev-time macOS branding: Electron.app ships as "Electron" in the Dock.
 * Packaged builds already use productName from electron-builder.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_NAME = 'Letter Box';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (process.platform !== 'darwin') {
  process.exit(0);
}

let electronDist;
try {
  electronDist = dirname(require.resolve('electron/package.json'));
} catch {
  console.warn('[patch-electron] electron package not found, skip');
  process.exit(0);
}

const appRoot = join(electronDist, 'dist', 'Electron.app');
const plist = join(appRoot, 'Contents', 'Info.plist');
if (!existsSync(plist)) {
  console.warn('[patch-electron] Electron.app Info.plist missing, skip');
  process.exit(0);
}

function setPlist(key, value) {
  const quoted = value.includes(' ') ? `"${value}"` : value;
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${quoted}`, plist], {
      stdio: 'ignore',
    });
  } catch {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${quoted}`, plist], {
        stdio: 'ignore',
      });
    } catch (error) {
      console.warn(`[patch-electron] failed to set ${key}:`, error instanceof Error ? error.message : error);
    }
  }
}

setPlist('CFBundleName', APP_NAME);
setPlist('CFBundleDisplayName', APP_NAME);

const iconSrc = join(root, 'build', 'icon.icns');
const iconDest = join(appRoot, 'Contents', 'Resources', 'electron.icns');
if (existsSync(iconSrc) && existsSync(dirname(iconDest))) {
  try {
    copyFileSync(iconSrc, iconDest);
  } catch (error) {
    console.warn('[patch-electron] failed to copy icon:', error instanceof Error ? error.message : error);
  }
}

console.log(`[patch-electron] macOS app branded as "${APP_NAME}"`);
