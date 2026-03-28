import { contextBridge, ipcRenderer } from 'electron';

export type TemplateListItem = { path: string; name: string; source: 'bundled' | 'user' | 'custom' };

const markAPI = {
  getStore: <K extends string>(key: K) => ipcRenderer.invoke('mark:get-store', key),
  setStore: (key: string, value: unknown) => ipcRenderer.invoke('mark:set-store', key, value),
  templatesDir: () => ipcRenderer.invoke('mark:templates-dir') as Promise<string>,
  userTemplatesDir: () => ipcRenderer.invoke('mark:user-templates-dir') as Promise<string>,
  dialogOpen: () => ipcRenderer.invoke('mark:dialog-open') as Promise<string | null>,
  dialogSave: (defaultPath?: string) =>
    ipcRenderer.invoke('mark:dialog-save', defaultPath) as Promise<string | null>,
  readFile: (filePath: string) =>
    ipcRenderer.invoke('mark:read-file', filePath) as Promise<
      { ok: true; content: string } | { ok: false; error: string }
    >,
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('mark:write-file', filePath, content) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  pushRecent: (filePath: string) => ipcRenderer.invoke('mark:push-recent', filePath) as Promise<string[]>,
  listTemplates: () => ipcRenderer.invoke('mark:list-templates') as Promise<TemplateListItem[]>,
  saveTemplateFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('mark:save-template-file', filePath, content) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  deleteTemplateFile: (filePath: string) =>
    ipcRenderer.invoke('mark:delete-template-file', filePath) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  setDirty: (dirty: boolean) => ipcRenderer.send('mark:set-dirty', dirty),
  windowIsMaximized: () => ipcRenderer.invoke('mark:window-is-maximized') as Promise<boolean>,
  windowMinimize: () => ipcRenderer.send('mark:window-minimize'),
  windowToggleMaximize: () => ipcRenderer.send('mark:window-toggle-maximize'),
  windowClose: () => ipcRenderer.send('mark:window-close'),
  subscribeWindowMaximized: (callback: (maximized: boolean) => void) => {
    const listener = (_e: unknown, state: { maximized: boolean }) => callback(state.maximized);
    ipcRenderer.on('mark:window-state', listener);
    return () => ipcRenderer.removeListener('mark:window-state', listener);
  },
};

contextBridge.exposeInMainWorld('markAPI', markAPI);

export type MarkAPI = typeof markAPI;
