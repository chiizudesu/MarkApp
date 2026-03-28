export type ShortcutHandler = (e: KeyboardEvent) => void;

export interface ShortcutBinding {
  id: string;
  label: string;
  key: string;
  /** e.g. ctrl+s — normalized match */
  match: (e: KeyboardEvent) => boolean;
  handler: ShortcutHandler;
}

function normKey(k: string) {
  return k.toLowerCase();
}

export function isMod(e: KeyboardEvent) {
  return e.metaKey || e.ctrlKey;
}

export function binding(
  id: string,
  label: string,
  key: string,
  match: (e: KeyboardEvent) => boolean,
  handler: ShortcutHandler,
): ShortcutBinding {
  return { id, label, key, match, handler };
}

/** Ctrl/Cmd+S */
export function matchSave(e: KeyboardEvent) {
  return isMod(e) && normKey(e.key) === "s" && !e.shiftKey;
}

export function matchSaveAs(e: KeyboardEvent) {
  return isMod(e) && normKey(e.key) === "s" && e.shiftKey;
}

export function matchCopyDoc(e: KeyboardEvent) {
  return isMod(e) && normKey(e.key) === "c" && e.shiftKey;
}

export function matchToggleAgent(e: KeyboardEvent) {
  return isMod(e) && normKey(e.key) === "l";
}

export function matchQuickAI(e: KeyboardEvent) {
  return isMod(e) && normKey(e.key) === "k";
}

export function matchCommandPalette(e: KeyboardEvent) {
  return isMod(e) && normKey(e.key) === "p" && e.shiftKey;
}

export function matchBold(e: KeyboardEvent) {
  return isMod(e) && normKey(e.key) === "b";
}

export function matchItalic(e: KeyboardEvent) {
  return isMod(e) && normKey(e.key) === "i";
}

export function matchLink(e: KeyboardEvent) {
  return isMod(e) && normKey(e.key) === "k";
}

export function matchHeading(e: KeyboardEvent, level: 1 | 2 | 3 | 4 | 5 | 6) {
  return isMod(e) && e.key === String(level);
}
