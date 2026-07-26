import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { installFileLogger } from './logger';
import { clearSession, loadSession, saveSession } from './session-store';

app.setName('Letter Box');
app.setPath('userData', join(app.getPath('appData'), 'Letter Box'));
const logPath = join(app.getPath('userData'), 'logs', 'main.log');
const apiUrl = process.env.LETTER_BOX_API_URL ?? 'http://127.0.0.1:3000';
installFileLogger(logPath);

ipcMain.handle('session:load', () => loadSession());
ipcMain.handle('session:save', (_event, value: unknown) => {
  if (typeof value !== 'string' || value.length > 16_384) {
    throw new Error('Некорректная desktop-сессия');
  }
  saveSession(value);
});
ipcMain.handle('session:clear', () => clearSession());

let mainWindow: BrowserWindow | null = null;

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 820,
    minHeight: 540,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f4f4f1',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
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
  return window;
};

async function loadApplication(window: BrowserWindow): Promise<void> {
  console.info('Загрузка renderer', { packaged: app.isPackaged, apiUrl });
  if (app.isPackaged) {
    await window.loadFile(join(__dirname, '../dist/index.html'), {
      query: { api: apiUrl },
    });
  } else {
    await window.loadURL(
      `http://127.0.0.1:5173/?api=${encodeURIComponent(apiUrl)}`,
    );
    window.webContents.openDevTools({ mode: 'detach' });
  }
}

void app.whenReady().then(async () => {
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
