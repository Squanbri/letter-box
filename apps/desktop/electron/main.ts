import {
  app,
  BrowserWindow,
  safeStorage,
  shell,
} from 'electron';
import {
  type AccountConfig,
  type ApiHandle,
  type CredentialStore,
  startApi,
} from '@letter-box/backend';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installFileLogger } from './logger';

app.setName('Letter Box');
app.setPath('userData', join(app.getPath('appData'), 'Letter Box'));
const logPath = join(app.getPath('userData'), 'logs', 'main.log');
installFileLogger(logPath);

interface StoredAccount extends Omit<AccountConfig, 'password'> {
  encryptedPassword: string;
}

class KeychainCredentialStore implements CredentialStore {
  private readonly filePath: string;

  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, 'account.json');
  }

  async load(): Promise<AccountConfig | null> {
    try {
      const stored = JSON.parse(await readFile(this.filePath, 'utf8')) as StoredAccount;
      const password = safeStorage.decryptString(
        Buffer.from(stored.encryptedPassword, 'base64'),
      );
      return {
        provider: stored.provider,
        email: stored.email,
        host: stored.host,
        port: stored.port,
        secure: stored.secure,
        password,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.error('Не удалось прочитать настройки аккаунта', error);
      }
      return null;
    }
  }

  async save(account: AccountConfig): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('macOS Keychain недоступен');
    }

    const directory = app.getPath('userData');
    const temporaryPath = `${this.filePath}.tmp`;
    const stored: StoredAccount = {
      provider: account.provider,
      email: account.email,
      host: account.host,
      port: account.port,
      secure: account.secure,
      encryptedPassword: safeStorage.encryptString(account.password).toString('base64'),
    };

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(stored, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}

let apiHandle: ApiHandle | null = null;
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
  window.webContents.on(
    'console-message',
    (_event, level, rendererMessage, lineNumber, sourceId) => {
      const message = `[renderer:console] ${rendererMessage} (${sourceId}:${lineNumber})`;
      if (level >= 3) {
        console.error(message);
      } else if (level === 2) {
        console.warn(message);
      } else {
        console.info(message);
      }
    },
  );

  return window;
};

async function loadApplication(window: BrowserWindow, apiUrl: string): Promise<void> {
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
  console.info('Renderer загружен', window.webContents.getURL());
}

async function showStartup(
  window: BrowserWindow,
  status: string,
  error?: string,
): Promise<void> {
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(startupHtml(status, error))}`,
  );
}

async function updateStartup(window: BrowserWindow, status: string): Promise<void> {
  await window.webContents.executeJavaScript(
    `document.getElementById('status').textContent = ${JSON.stringify(status)}`,
  );
}

function startupHtml(status: string, error?: string): string {
  const errorMarkup = error
    ? `<div class="error">${escapeHtml(error)}</div>
       <div class="log">Лог: ${escapeHtml(logPath)}</div>`
    : '<div class="spinner"></div>';
  return `<!doctype html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <style>
          :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3f4f0; color: #30322e; }
          main { width: min(460px, calc(100vw - 64px)); text-align: center; }
          .mark { width: 54px; height: 54px; display: grid; place-items: center; margin: 0 auto 20px; border-radius: 15px; background: #31594a; color: white; font-size: 27px; }
          h1 { margin: 0 0 8px; font-size: 25px; }
          #status { color: #74776f; font-size: 14px; }
          .spinner { width: 22px; height: 22px; margin: 24px auto 0; border: 2px solid #d5d9d2; border-top-color: #31594a; border-radius: 50%; animation: spin .8s linear infinite; }
          .error { margin-top: 22px; padding: 12px; border-radius: 9px; background: #fff0ed; color: #942f22; font-size: 13px; line-height: 1.45; }
          .log { margin-top: 12px; color: #777a73; font: 11px/1.5 ui-monospace, monospace; word-break: break-all; }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <main>
          <div class="mark">✉</div>
          <h1>Letter Box</h1>
          <div id="status">${escapeHtml(status)}</div>
          ${errorMarkup}
        </main>
      </body>
    </html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

void app.whenReady().then(async () => {
  mainWindow = createWindow();
  await showStartup(mainWindow, 'Подготовка локального хранилища…');

  try {
    const dataDirectory = app.getPath('userData');
    console.info('Запуск backend', { dataDirectory });
    await updateStartup(mainWindow, 'Запуск локального почтового сервиса…');
    apiHandle = await startApi({
      port: app.isPackaged ? 0 : Number(process.env.API_PORT ?? 3000),
      databasePath: join(dataDirectory, 'letter-box.db'),
      credentialStore: new KeychainCredentialStore(dataDirectory),
    });

    await updateStartup(mainWindow, 'Загрузка интерфейса…');
    await loadApplication(mainWindow, apiHandle.url);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error('Приложение не запустилось', error);
    await showStartup(
      mainWindow,
      'Не удалось запустить приложение',
      message,
    );
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      if (apiHandle) {
        void loadApplication(mainWindow, apiHandle.url);
      } else {
        void showStartup(mainWindow, 'Локальный сервис недоступен');
      }
    }
  });
});

app.on('before-quit', () => {
  void apiHandle?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
