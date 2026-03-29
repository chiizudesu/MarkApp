const api = () => {
  if (typeof window === "undefined" || !window.markAPI) {
    throw new Error("MarkApp must run in Electron");
  }
  return window.markAPI;
};

export async function openFileDialog(): Promise<string | null> {
  return api().dialogOpen();
}

export async function saveFileDialog(defaultPath?: string): Promise<string | null> {
  return api().dialogSave(defaultPath);
}

export async function openDirectoryDialog(): Promise<string | null> {
  return api().dialogOpenDirectory();
}

export async function readTextFile(path: string): Promise<string> {
  const r = await api().readFile(path);
  if (!r.ok) throw new Error(r.error);
  return r.content;
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  const r = await api().writeFile(path, content);
  if (!r.ok) throw new Error(r.error);
}

export async function pushRecent(path: string): Promise<string[]> {
  return api().pushRecent(path);
}

export async function getStoreKey<K extends string>(key: K): Promise<unknown> {
  return api().getStore(key);
}

export async function setStoreKey(key: string, value: unknown): Promise<void> {
  await api().setStore(key, value);
}
