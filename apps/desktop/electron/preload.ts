import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('letterBoxSession', {
  load: (): Promise<string | null> => ipcRenderer.invoke('session:load'),
  save: (value: string): Promise<void> => ipcRenderer.invoke('session:save', value),
  clear: (): Promise<void> => ipcRenderer.invoke('session:clear'),
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
