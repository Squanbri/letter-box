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

app.setName('Letter Box');
app.setPath('userData', join(app.getPath('appData'), 'Letter Box'));

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

const createWindow = (apiUrl: string): void => {
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

  if (app.isPackaged) {
    void window.loadFile(join(__dirname, '../dist/index.html'), {
      query: { api: apiUrl },
    });
  } else {
    void window.loadURL(
      `http://127.0.0.1:5173/?api=${encodeURIComponent(apiUrl)}`,
    );
    window.webContents.openDevTools({ mode: 'detach' });
  }
};

void app.whenReady().then(async () => {
  const dataDirectory = app.getPath('userData');
  apiHandle = await startApi({
    port: app.isPackaged ? 0 : Number(process.env.API_PORT ?? 3000),
    databasePath: join(dataDirectory, 'letter-box.db'),
    credentialStore: new KeychainCredentialStore(dataDirectory),
  });

  createWindow(apiHandle.url);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(apiHandle!.url);
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
