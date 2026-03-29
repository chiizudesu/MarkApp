/** Shortcut label: Cmd on Apple platforms, Ctrl elsewhere. */
export function modShortcut(key: string): string {
  if (typeof navigator === "undefined") return `Ctrl+${key}`;
  const apple = /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes("Mac");
  return `${apple ? "⌘" : "Ctrl"}+${key}`;
}

export function modShiftShortcut(key: string): string {
  if (typeof navigator === "undefined") return `Ctrl+Shift+${key}`;
  const apple = /Mac|iPhone|iPod|iPad/i.test(navigator.platform) || navigator.userAgent.includes("Mac");
  return apple ? `⌘⇧${key}` : `Ctrl+Shift+${key}`;
}
