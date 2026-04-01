import { normalizeAssistantMarkdownParagraphs } from "@/utils/markdownFence";

/** Stable short hash for comparing applied slices after Plate round-trips. */
export function hashMarkdownSlice(doc: string, span: { from: number; to: number }): string {
  const slice = doc.slice(span.from, span.to);
  const norm = normalizeAssistantMarkdownParagraphs(slice);
  let h = 5381;
  for (let i = 0; i < norm.length; i++) {
    h = ((h << 5) + h) ^ norm.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/**
 * Approximate [from, to) in `after` covering the replaced region vs `before`
 * (single contiguous replace). Works for typical section / whole-doc replaces.
 */
export function findReplacedMarkdownSpan(before: string, after: string): { from: number; to: number } | null {
  if (before === after) return null;
  if (before.length === 0) return { from: 0, to: after.length };
  if (after.length === 0) return { from: 0, to: 0 };
  let i = 0;
  const maxI = Math.min(before.length, after.length);
  while (i < maxI && before[i] === after[i]) i++;
  let j = 0;
  while (
    j < before.length - i &&
    j < after.length - i &&
    before[before.length - 1 - j] === after[after.length - 1 - j]
  ) {
    j++;
  }
  const from = i;
  const to = after.length - j;
  if (to < from) return null;
  return { from, to };
}
