import "react";

export type TemplateListItem = { path: string; name: string; source: 'user' | 'custom' };

declare module "react" {
  interface CSSProperties {
    WebkitAppRegion?: "drag" | "no-drag";
  }
}

declare global {
  interface Window {
    /** Exposed by Electron preload; missing in plain Vite/browser. */
    markAPI?: {
      getStore: <K extends string>(key: K) => Promise<unknown>;
      setStore: (key: string, value: unknown) => Promise<boolean>;
      templatesDir: () => Promise<string>;
      userTemplatesDir: () => Promise<string>;
      dialogOpen: () => Promise<string | null>;
      dialogSave: (defaultPath?: string) => Promise<string | null>;
      dialogSavePdf: (defaultPath?: string) => Promise<string | null>;
      dialogOpenDirectory: () => Promise<string | null>;
      readFile: (
        filePath: string
      ) => Promise<{ ok: true; content: string } | { ok: false; error: string }>;
      writeFile: (
        filePath: string,
        content: string
      ) => Promise<{ ok: true } | { ok: false; error: string }>;
      writeFileBinary: (
        filePath: string,
        base64: string
      ) => Promise<{ ok: true } | { ok: false; error: string }>;
      pushRecent: (filePath: string) => Promise<string[]>;
      listTemplates: () => Promise<TemplateListItem[]>;
      saveTemplateFile: (
        filePath: string,
        content: string
      ) => Promise<{ ok: true } | { ok: false; error: string }>;
      deleteTemplateFile: (
        filePath: string
      ) => Promise<{ ok: true } | { ok: false; error: string }>;
      setDirty: (dirty: boolean) => void;
      windowIsMaximized: () => Promise<boolean>;
      windowMinimize: () => void;
      windowToggleMaximize: () => void;
      windowClose: () => void;
      subscribeWindowMaximized: (callback: (maximized: boolean) => void) => () => void;
      subscribeSaveBeforeClose: (run: () => Promise<boolean>) => () => void;
    };
  }
}

export {};
