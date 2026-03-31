import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type MarkStore = {
  recentFiles: string[];
  anthropicApiKey?: string;
  templateFolderPath?: string;
  claudeModel?: string;
  autoSaveMs?: number;
};

const DEFAULT_AGENT_MODEL = 'claude-haiku-4-5';
/** Keep in sync with LEGACY_AGENT_MODEL_IDS in src/services/claude.ts */
const LEGACY_AGENT_MODELS = new Set(['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022']);

const store = new Store<MarkStore>({
  name: 'markapp',
  defaults: {
    recentFiles: [],
    autoSaveMs: 30000,
    claudeModel: DEFAULT_AGENT_MODEL,
  },
});

function migrateClaudeAgentModel(): void {
  const cur = store.get('claudeModel');
  const t = typeof cur === 'string' ? cur.trim() : '';
  if (!t || LEGACY_AGENT_MODELS.has(t)) {
    store.set('claudeModel', DEFAULT_AGENT_MODEL);
  }
}
migrateClaudeAgentModel();

function getTemplatesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'templates');
  }
  return join(app.getAppPath(), 'templates');
}

function ensureUserTemplatesDir(): string {
  const base = join(app.getPath('userData'), 'templates');
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}

let mainWindow: BrowserWindow | null = null;
let dirtyFlag = false;

/**
 * Windows `BrowserWindow` needs a raster. Prefer `icon.png` (export from `public/icon.svg`) so it
 * matches the in-app SVG; else packaged `build/icons/win/icon.ico` (regenerate from the same SVG).
 */
function resolveWindowIconPath(): string {
  const distPng = join(__dirname, '../dist/icon.png');
  const publicPng = join(app.getAppPath(), 'public', 'icon.png');
  if (existsSync(distPng)) return distPng;
  if (!app.isPackaged && existsSync(publicPng)) return publicPng;
  return app.isPackaged
    ? join(process.resourcesPath, 'build/icons/win/icon.ico')
    : join(app.getAppPath(), 'build/icons/win/icon.ico');
}

function createWindow() {
  const iconPath = resolveWindowIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'MarkApp',
    show: false,
  });

  const broadcastWindowState = () => {
    if (!mainWindow) return;
    mainWindow.webContents.send('mark:window-state', { maximized: mainWindow.isMaximized() });
  };
  mainWindow.on('maximize', broadcastWindowState);
  mainWindow.on('unmaximize', broadcastWindowState);

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (e) => {
    if (!dirtyFlag) return;
    e.preventDefault();
    const res = dialog.showMessageBoxSync(mainWindow!, {
      type: 'question',
      buttons: ['Cancel', 'Discard changes'],
      defaultId: 0,
      message: 'Unsaved changes',
      detail: 'Discard changes and close?',
    });
    if (res === 0) return;
    dirtyFlag = false;
    mainWindow?.destroy();
  });
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.on('mark:set-dirty', (_e, v: boolean) => {
    dirtyFlag = !!v;
  });

  ipcMain.handle('mark:window-is-maximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.on('mark:window-minimize', () => mainWindow?.minimize());
  ipcMain.on('mark:window-toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('mark:window-close', () => mainWindow?.close());

  ipcMain.handle('mark:get-store', (_e, key: keyof MarkStore) => store.get(key));
  ipcMain.handle('mark:set-store', (_e, key: keyof MarkStore, value: unknown) => {
    if (value === undefined) {
      store.delete(key as string);
    } else {
      store.set(key as string, value as never);
    }
    return true;
  });

  ipcMain.handle('mark:templates-dir', () => getTemplatesDir());
  ipcMain.handle('mark:user-templates-dir', () => ensureUserTemplatesDir());

  ipcMain.handle('mark:dialog-open', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }, { name: 'All', extensions: ['*'] }],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('mark:dialog-save', async (_e, defaultPath?: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return null;
    let p = r.filePath;
    if (!p.endsWith('.md')) p += '.md';
    return p;
  });

  ipcMain.handle('mark:dialog-open-directory', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('mark:read-file', async (_e, filePath: string) => {
    try {
      const content = readFileSync(filePath, 'utf-8');
      return { ok: true as const, content };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });

  ipcMain.handle('mark:write-file', async (_e, filePath: string, content: string) => {
    try {
      writeFileSync(filePath, content, 'utf-8');
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });

  ipcMain.handle('mark:push-recent', (_e, filePath: string) => {
    const recent = store.get('recentFiles') ?? [];
    const next = [filePath, ...recent.filter((p) => p !== filePath)].slice(0, 12);
    store.set('recentFiles', next);
    return next;
  });

  ipcMain.handle('mark:list-templates', async () => {
    const bundledDir = getTemplatesDir();
    const userDir = ensureUserTemplatesDir();
    const dirs = [bundledDir, userDir];
    const custom = store.get('templateFolderPath');
    if (custom && existsSync(custom)) dirs.push(custom);

    const files: Array<{ path: string; name: string; source: 'bundled' | 'user' | 'custom' }> = [];
    const seen = new Set<string>();
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      let source: 'bundled' | 'user' | 'custom' = 'bundled';
      if (d === userDir) source = 'user';
      else if (custom && d === custom) source = 'custom';
      try {
        for (const name of readdirSync(d)) {
          if (!name.endsWith('.md') && !name.endsWith('.markdown')) continue;
          const path = join(d, name);
          const st = statSync(path);
          if (!st.isFile()) continue;
          const key = path.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          files.push({ path, name, source });
        }
      } catch {
        /* ignore */
      }
    }
    return files;
  });

  ipcMain.handle('mark:save-template-file', async (_e, filePath: string, content: string) => {
    try {
      writeFileSync(filePath, content, 'utf-8');
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });

  ipcMain.handle('mark:delete-template-file', async (_e, filePath: string) => {
    try {
      unlinkSync(filePath);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
