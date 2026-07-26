import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('letterBoxSession', {
  load: (): Promise<string | null> => ipcRenderer.invoke('session:load'),
  save: (value: string): Promise<void> => ipcRenderer.invoke('session:save', value),
  clear: (): Promise<void> => ipcRenderer.invoke('session:clear'),
});
