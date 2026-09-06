import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnvFiles } from './env';
import { installFileLogger } from './logger';
import { AccountOnboardingService } from './oauth/account-onboarding';
import { isCancelled } from './oauth/strategies';
import { clearSession, loadSession, saveSession } from './session-store';

loadEnvFiles([
  resolve(__dirname, '../../../.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(process.cwd(), '.env'),
]);

app.setName('Letter Box');
app.setPath('userData', join(app.getPath('appData'), 'Letter Box'));
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'Letter Box',
    applicationVersion: app.getVersion(),
    copyright: '© Evgeniy Markitan',
  });
}
const logPath = join(app.getPath('userData'), 'logs', 'main.log');
const apiUrl = process.env.LETTER_BOX_API_URL ?? 'http://127.0.0.1:3000';
installFileLogger(logPath);
const onboarding = new AccountOnboardingService(apiUrl);

ipcMain.handle('session:load', () => loadSession());
ipcMain.handle('session:save', (_event, value: unknown) => {
  if (typeof value !== 'string' || value.length > 16_384) {
    throw new Error('Некорректная desktop-сессия');
  }
  saveSession(value);
});
ipcMain.handle('session:clear', () => clearSession());

ipcMain.handle('account:add-oauth', async (event, input: unknown) => {
  try {
    return await onboarding.addOAuth(event.sender, input as { providerId: 'gmail' | 'yandex'; accountId?: string });
  } catch (error) {
    if (isCancelled(error)) return { cancelled: true };
    return { error: error instanceof Error ? error.message : 'Не удалось подключить почту' };
  }
});
ipcMain.handle('account:add-basic', async (event, input: unknown) => {
  try {
    return await onboarding.addBasic(event.sender, input as Parameters<AccountOnboardingService['addBasic']>[1]);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Не удалось подключить почту' };
  }
});
ipcMain.handle('account:cancel-oauth', () => {
  onboarding.cancel();
});
ipcMain.handle('account:submit-oauth-code', (_event, code: unknown) => {
  if (typeof code !== 'string' || !code.trim()) {
    return { error: 'Вставьте код подтверждения Яндекса' };
  }
  try {
    onboarding.submitOAuthCode(code.trim());
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Не удалось принять код' };
  }
});
ipcMain.handle('account:forget-tokens', (_event, key: unknown) => {
  if (typeof key === 'string' && key) onboarding.forget(key);
});

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.handle('window:minimize', (event) => {
  windowFromEvent(event)?.minimize();
});
ipcMain.handle('window:maximize', (event) => {
  const window = windowFromEvent(event);
  if (!window) return;
  if (window.isFullScreen()) window.setFullScreen(false);
  else if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});
ipcMain.handle('window:close', (event) => {
  windowFromEvent(event)?.close();
});

type ComposePayload = {
  accountId: string;
  draft: unknown;
  thread?: unknown;
  tagHint?: string | null;
};

const composeDrafts = new Map<string, ComposePayload>();
const composeWindows = new Map<string, BrowserWindow>();

ipcMain.handle('compose:open', (_event, payload: ComposePayload) => {
  const id = randomUUID();
  composeDrafts.set(id, payload);
  const window = createComposeWindow(id);
  composeWindows.set(id, window);
  window.on('closed', () => {
    composeWindows.delete(id);
    composeDrafts.delete(id);
  });
  return id;
});

ipcMain.handle('compose:load', (_event, id: unknown) => {
  if (typeof id !== 'string') return null;
  return composeDrafts.get(id) ?? null;
});

ipcMain.handle('compose:close', (_event, id: unknown) => {
  if (typeof id !== 'string') return;
  const window = composeWindows.get(id);
  if (window && !window.isDestroyed()) window.close();
  composeWindows.delete(id);
  composeDrafts.delete(id);
});

let mainWindow: BrowserWindow | null = null;

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath, 'icon.png'),
    join(__dirname, '../build/icon-mac.png'),
    join(__dirname, '../build/icon.png'),
  ];
  return candidates.find((path) => existsSync(path));
}

function applyDockIcon(iconPath?: string): void {
  if (process.platform !== 'darwin' || !iconPath) return;
  try {
    app.dock?.setIcon(iconPath);
  } catch (error) {
    console.warn('Не удалось установить иконку Dock', error);
  }
}

function attachWindowGuards(window: BrowserWindow): void {
  window.setWindowButtonVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('Renderer не загрузился', { code, description, url });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process завершился', details);
  });
}

const createWindow = (): BrowserWindow => {
  const icon = resolveAppIcon();
  applyDockIcon(icon);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 540,
    title: 'Letter Box',
    titleBarStyle: 'hidden',
    backgroundColor: '#fbfaf7',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachWindowGuards(window);
  return window;
};

function createComposeWindow(composeId: string): BrowserWindow {
  const icon = resolveAppIcon();
  const window = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 800,
    minHeight: 520,
    title: 'Letter Box',
    titleBarStyle: 'hidden',
    backgroundColor: '#fbfaf7',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachWindowGuards(window);
  void loadApplication(window, { compose: composeId });
  return window;
}

async function loadApplication(
  window: BrowserWindow,
  query: Record<string, string> = {},
): Promise<void> {
  const params = new URLSearchParams({ api: apiUrl, ...query });
  console.info('Загрузка renderer', { packaged: app.isPackaged, apiUrl, query });
  if (app.isPackaged) {
    await window.loadFile(join(__dirname, '../dist/index.html'), {
      query: Object.fromEntries(params.entries()),
    });
  } else {
    await window.loadURL(`http://127.0.0.1:5173/?${params.toString()}`);
    if (!query.compose) {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  }
}

void app.whenReady().then(async () => {
  applyDockIcon(resolveAppIcon());
  mainWindow = createWindow();
  await loadApplication(mainWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      void loadApplication(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
