import DiffMatchPatch from "diff-match-patch";

const dmp = new DiffMatchPatch();

export type DiffOp = 0 | -1 | 1;

export interface DiffPart {
  op: DiffOp;
  text: string;
}

/** Google diff-match-patch: 0=equal, -1=delete, 1=insert */
export function computeDiffParts(oldText: string, newText: string): DiffPart[] {
  const diffs = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text]) => ({ op: op as DiffOp, text }));
}

export interface DiffHunk {
  id: string;
  parts: DiffPart[];
  /** In old string: replace slice [oldFrom, oldTo) with newText */
  oldFrom: number;
  oldTo: number;
  newText: string;
}

/** Group consecutive non-equal diff ops into hunks (for per-hunk accept, apply bottom-up). */
export function buildHunks(oldText: string, newText: string): DiffHunk[] {
  const parts = computeDiffParts(oldText, newText);
  const hunks: DiffHunk[] = [];
  let oldPos = 0;
  let i = 0;
  let idx = 0;
  while (i < parts.length) {
    if (parts[i].op === 0) {
      oldPos += parts[i].text.length;
      i++;
      continue;
    }
    const oldFrom = oldPos;
    const hunkParts: DiffPart[] = [];
    let newBuf = "";
    while (i < parts.length && parts[i].op !== 0) {
      hunkParts.push(parts[i]);
      if (parts[i].op === -1) {
        oldPos += parts[i].text.length;
      } else {
        newBuf += parts[i].text;
      }
      i++;
    }
    hunks.push({
      id: `hunk-${idx++}`,
      parts: hunkParts,
      oldFrom,
      oldTo: oldPos,
      newText: newBuf,
    });
  }
  return hunks;
}

export function applyRangeReplace(full: string, from: number, to: number, newText: string): string {
  return full.slice(0, from) + newText + full.slice(to);
}

/** Apply hunks in descending oldFrom order so indices stay valid. */
export function applyHunksToString(oldText: string, hunks: DiffHunk[], acceptedIds: Set<string>): string {
  const toApply = hunks.filter((h) => acceptedIds.has(h.id)).sort((a, b) => b.oldFrom - a.oldFrom);
  let s = oldText;
  for (const h of toApply) {
    s = applyRangeReplace(s, h.oldFrom, h.oldTo, h.newText);
  }
  return s;
}
