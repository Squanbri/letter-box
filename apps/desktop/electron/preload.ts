import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('letterBoxSession', {
  load: (): Promise<string | null> => ipcRenderer.invoke('session:load'),
  save: (value: string): Promise<void> => ipcRenderer.invoke('session:save', value),
  clear: (): Promise<void> => ipcRenderer.invoke('session:clear'),
  onUpdated: (listener: (value: string) => void): (() => void) => {
    const wrapped = (_event: unknown, value: unknown) => {
      if (typeof value === 'string') listener(value);
    };
    ipcRenderer.on('session:updated', wrapped);
    return () => {
      ipcRenderer.removeListener('session:updated', wrapped);
    };
  },
});

contextBridge.exposeInMainWorld('letterBoxCompose', {
  open: (payload: unknown): Promise<string> => ipcRenderer.invoke('compose:open', payload),
  load: (id: string): Promise<unknown> => ipcRenderer.invoke('compose:load', id),
  close: (id: string): Promise<void> => ipcRenderer.invoke('compose:close', id),
});

contextBridge.exposeInMainWorld('letterBoxWindow', {
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close'),
});

contextBridge.exposeInMainWorld('letterBoxAccounts', {
  addOAuth: (input: unknown): Promise<unknown> => ipcRenderer.invoke('account:add-oauth', input),
  addBasic: (input: unknown): Promise<unknown> => ipcRenderer.invoke('account:add-basic', input),
  submitOAuthCode: (code: string): Promise<unknown> => ipcRenderer.invoke('account:submit-oauth-code', code),
  cancelOAuth: (): Promise<void> => ipcRenderer.invoke('account:cancel-oauth'),
  forgetTokens: (key: string): Promise<void> => ipcRenderer.invoke('account:forget-tokens', key),
  onOnboarding: (listener: (event: unknown) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on('account:onboarding', wrapped);
    return () => {
      ipcRenderer.removeListener('account:onboarding', wrapped);
    };
  },
});
