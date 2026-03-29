import { Editor } from "slate";

/** Fallback size when no explicit fontSize mark (toolbar + bump baseline). */
export const BASE_FONT_SIZE_PX = 12;

/** Allowed sizes (px), even steps 6–144 */
export const FONT_SIZE_VALUES: number[] = Array.from({ length: (144 - 6) / 2 + 1 }, (_, i) => 6 + i * 2);

export function parseFontSizePx(mark: string | undefined): number | null {
  if (!mark) return null;
  const m = mark.trim().match(/^(\d+(?:\.\d+)?)px$/i);
  if (m) return Math.round(Number(m[1]));
  const n = Number.parseInt(mark, 10);
  return Number.isFinite(n) ? n : null;
}

export function snapFontSizePx(n: number): number {
  const clamped = Math.min(144, Math.max(6, Math.round(n)));
  const even = Math.round(clamped / 2) * 2;
  return Math.min(144, Math.max(6, even));
}

/** Next size in FONT_SIZE_VALUES, or null at an end of the range. */
export function nextFontSizeStep(currentPx: number, dir: 1 | -1): number | null {
  if (dir > 0) {
    const next = FONT_SIZE_VALUES.find((s) => s > currentPx);
    return next ?? null;
  }
  for (let i = FONT_SIZE_VALUES.length - 1; i >= 0; i--) {
    const s = FONT_SIZE_VALUES[i];
    if (s < currentPx) return s;
  }
  return null;
}

/** Bump font size at selection using the same steps as the toolbar (even px grid). */
export function bumpEditorFontSize(editor: { selection?: unknown; tf: { fontSize?: { addMark?: (v: string) => void } } } | null, dir: 1 | -1): void {
  if (!editor?.selection) return;
  try {
    const marks = (Editor.marks(editor as any) ?? {}) as Record<string, unknown>;
    const raw = marks["fontSize"] as string | undefined;
    const effective = parseFontSizePx(raw) ?? BASE_FONT_SIZE_PX;
    const next = nextFontSizeStep(effective, dir);
    if (next == null) return;
    const snapped = snapFontSizePx(next);
    editor.tf.fontSize?.addMark?.(`${snapped}px`);
  } catch {
    /* slate edge cases */
  }
}
