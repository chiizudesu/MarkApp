/** IPC bridge from Electron preload; throws if missing (e.g. plain browser). */
export function requireMarkAPI(): NonNullable<Window["markAPI"]> {
  const api = window.markAPI;
  if (!api) {
    throw new Error("MarkApp must run in Electron (preload not loaded).");
  }
  return api;
}
