export interface DocSection {
  id: string;
  title: string;
  level: number;
  from: number;
  to: number;
  content: string;
}

export interface OutlineNode {
  id: string;
  title: string;
  level: number;
  from: number;
  children: OutlineNode[];
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

type HeadingMarker = {
  level: number;
  title: string;
  from: number;
  line: number;
  implicit?: boolean;
};

const HEADING_TYPES = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Plate often serializes “empty” paragraphs as a zero‑width space; treat as blank for outline gaps. */
const OUTLINE_BLANK_STRIP = /[\u200B-\u200D\uFEFF]/g;

export function isOutlineBlankLine(line: string): boolean {
  return line.replace(OUTLINE_BLANK_STRIP, "").trim() === "";
}

/** Markdown offset of block i from prefix serialization (length of serialize(children.slice(0,i))). */
export type OutlineBoldBlockHint = { mdStart: number; title: string };

function countConsecutiveBlankLinesAbove(lines: string[], lineIndex: number): number {
  let n = 0;
  for (let k = lineIndex - 1; k >= 0 && isOutlineBlankLine(lines[k]); k--) {
    n++;
  }
  return n;
}

function isBoldOnlyPlateParagraph(node: unknown): boolean {
  if (!node || typeof node !== "object" || !("children" in node)) return false;
  const el = node as { type?: string; children?: unknown[] };
  if (el.type !== "p" || !Array.isArray(el.children) || el.children.length === 0) return false;
  let hasVisible = false;
  const walk = (children: unknown[]): boolean => {
    for (const ch of children) {
      if (!ch || typeof ch !== "object") return false;
      const c = ch as { text?: string; bold?: boolean; children?: unknown[] };
      if (Array.isArray(c.children)) {
        if (!walk(c.children)) return false;
      } else if (typeof c.text === "string") {
        if (c.text.length === 0) continue;
        if (!c.bold) return false;
        if (c.text.replace(OUTLINE_BLANK_STRIP, "").trim().length > 0) hasVisible = true;
      }
    }
    return true;
  };
  return walk(el.children) && hasVisible;
}

function plateParagraphPlainText(node: unknown): string {
  if (!node || typeof node !== "object" || !("children" in node)) return "";
  const parts: string[] = [];
  const walk = (children: unknown[]) => {
    for (const ch of children) {
      if (!ch || typeof ch !== "object") continue;
      const c = ch as { text?: string; children?: unknown[] };
      if (typeof c.text === "string") parts.push(c.text);
      else if (Array.isArray(c.children)) walk(c.children);
    }
  };
  walk((node as { children: unknown[] }).children);
  return parts.join("").trim();
}

/**
 * Bold-only top-level paragraphs that may serialize without `**` in markdown (toolbar bold).
 */
export function collectBoldOnlyParagraphHints(
  topLevelBlocks: unknown[],
  blockStartOffsets: number[],
): OutlineBoldBlockHint[] {
  const hints: OutlineBoldBlockHint[] = [];
  const n = topLevelBlocks.length;
  for (let i = 0; i < n; i++) {
    if (!isBoldOnlyPlateParagraph(topLevelBlocks[i])) continue;
    const mdStart = blockStartOffsets[i];
    if (mdStart === undefined) continue;
    const title = plateParagraphPlainText(topLevelBlocks[i]);
    if (title.length < 2 || title.length > 88) continue;
    hints.push({ mdStart, title });
  }
  return hints;
}

export function headingLevelFromType(type?: string): number {
  if (!type || !HEADING_TYPES.has(type)) return 0;
  return Number.parseInt(type.slice(1), 10) || 0;
}

/**
 * Section boundaries from top-level editor blocks (WYSIWYG): walk to preceding heading,
 * then to next heading of same or higher level. Matches how ATX markdown sections work.
 */
export function getSectionBlockIndexRangeForTopLevelIndex(
  blocks: Array<{ type?: string }>,
  blockIndex: number,
): [number, number] {
  const n = blocks.length;
  if (n === 0) return [0, 0];
  const idx = Math.min(Math.max(0, blockIndex), n - 1);

  let foundHeadingAbove = false;
  let start = 0;
  let levelAtStart = 6;
  for (let i = idx; i >= 0; i--) {
    const lv = headingLevelFromType(blocks[i]?.type);
    if (lv > 0) {
      start = i;
      levelAtStart = lv;
      foundHeadingAbove = true;
      break;
    }
  }

  if (!foundHeadingAbove) {
    let firstHeading = n;
    for (let j = 0; j < n; j++) {
      if (headingLevelFromType(blocks[j]?.type) > 0) {
        firstHeading = j;
        break;
      }
    }
    return firstHeading === n ? [0, n - 1] : [0, firstHeading - 1];
  }

  let end = n - 1;
  for (let j = start + 1; j < n; j++) {
    const lv = headingLevelFromType(blocks[j]?.type);
    if (lv > 0 && lv <= levelAtStart) {
      end = j - 1;
      break;
    }
  }
  return [start, end];
}

/**
 * Top-level editor blocks whose serialized markdown span overlaps a section's [from, to).
 * blockStarts has length n+1 with blockStarts[0]=0 and blockStarts[i]=start offset of block i in md.
 */
export function topLevelBlocksIntersectingMarkdownRange(
  blockStarts: number[],
  secFrom: number,
  secTo: number,
): [number, number] | null {
  const n = blockStarts.length - 1;
  if (n <= 0) return null;
  let b0 = -1;
  let b1 = -1;
  for (let i = 0; i < n; i++) {
    if (blockStarts[i] < secTo && blockStarts[i + 1] > secFrom) {
      if (b0 < 0) b0 = i;
      b1 = i;
    }
  }
  if (b0 < 0) return null;
  return [b0, b1];
}

function collectHeadingMarkersFromMarkdown(
  doc: string,
): { markers: HeadingMarker[]; lines: string[]; deduped: HeadingMarker[] } {
  const lines = doc.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(offset);
    offset += lines[i].length + 1;
  }

  const markers: HeadingMarker[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(HEADING_RE);
    if (m) {
      markers.push({
        level: m[1].length,
        title: m[2].trim(),
        from: lineStarts[i],
        line: i,
      });
      continue;
    }

    const t = line.replace(OUTLINE_BLANK_STRIP, "").trim();
    if (t.length < 2 || t.length > 88) continue;
    if (/^[#>`|]/.test(t)) continue;
    if (/^[-*+]\s/.test(t)) continue;
    if (/^\d+\.\s/.test(t)) continue;

    const boldMatch = t.match(/^\*\*([^*]+)\*\*$/) ?? t.match(/^__([^_]+)__$/);
    if (boldMatch) {
      if (i > 0 && !isOutlineBlankLine(lines[i - 1])) {
        continue;
      }
      markers.push({
        level: 2,
        title: boldMatch[1].trim(),
        from: lineStarts[i],
        line: i,
        implicit: true,
      });
      continue;
    }

    if (/[.,;:!?]$/.test(t)) continue;
    const blanksAbove = countConsecutiveBlankLinesAbove(lines, i);
    if (i > 0 && blanksAbove < 2) continue;
    let j = i + 1;
    while (j < lines.length && isOutlineBlankLine(lines[j])) j++;

    markers.push({
      level: 2,
      title: t,
      from: lineStarts[i],
      line: i,
      implicit: true,
    });
  }

  markers.sort((a, b) => a.from - b.from);

  const deduped: HeadingMarker[] = [];
  const seenFrom = new Set<number>();
  for (const mk of markers) {
    if (seenFrom.has(mk.from)) continue;
    seenFrom.add(mk.from);
    deduped.push(mk);
  }

  return { markers, lines, deduped };
}

/** 0-based line index in `doc` containing UTF-16 offset `pos` (same convention as markdown slices). */
function lineIndexAtDocOffset(doc: string, pos: number): number {
  const end = Math.max(0, Math.min(pos, doc.length));
  let line = 0;
  for (let i = 0; i < end; i++) {
    if (doc.charCodeAt(i) === 10) line++;
  }
  return line;
}

function mergeBoldBlockHints(
  markers: HeadingMarker[],
  hints: OutlineBoldBlockHint[],
  doc: string,
): HeadingMarker[] {
  const byFrom = new Map<number, HeadingMarker>();
  for (const mk of markers) {
    byFrom.set(mk.from, mk);
  }
  for (const h of hints) {
    if (byFrom.has(h.mdStart)) continue;
    const hintLine = lineIndexAtDocOffset(doc, h.mdStart);
    let sameLineSameTitle = false;
    const hintNorm = h.title.replace(OUTLINE_BLANK_STRIP, "").trim().toLowerCase();
    for (const m of byFrom.values()) {
      const mNorm = m.title.replace(OUTLINE_BLANK_STRIP, "").trim().toLowerCase();
      if (mNorm !== hintNorm) continue;
      if (lineIndexAtDocOffset(doc, m.from) === hintLine) {
        sameLineSameTitle = true;
        break;
      }
    }
    if (sameLineSameTitle) continue;
    byFrom.set(h.mdStart, {
      level: 2,
      title: h.title,
      from: h.mdStart,
      line: -1,
      implicit: true,
    });
  }
  return [...byFrom.values()].sort((a, b) => a.from - b.from);
}

/** Drop duplicate outline rows that share the same title on the same source line (offset mismatch edge cases). */
function dedupeMarkersSameLineSameTitle(doc: string, markers: HeadingMarker[]): HeadingMarker[] {
  const sorted = [...markers].sort((a, b) => a.from - b.from);
  const out: HeadingMarker[] = [];
  for (const m of sorted) {
    const lineIdx = lineIndexAtDocOffset(doc, m.from);
    const mNorm = m.title.replace(OUTLINE_BLANK_STRIP, "").trim().toLowerCase();
    const dup = out.some((o) => {
      const oNorm = o.title.replace(OUTLINE_BLANK_STRIP, "").trim().toLowerCase();
      return oNorm === mNorm && lineIndexAtDocOffset(doc, o.from) === lineIdx;
    });
    if (!dup) out.push(m);
  }
  return out;
}

/**
 * When the same source line qualifies as both a double-blank “gap” title and a bold header (md or Plate hint),
 * only one outline row should win. Higher number wins.
 */
function outlineMarkerPriority(m: HeadingMarker, doc: string): number {
  if (!m.implicit) return 4;
  if (m.line < 0) return 2;
  const lines = doc.split("\n");
  const idx = lineIndexAtDocOffset(doc, m.from);
  const raw = lines[idx] ?? "";
  const t = raw.replace(OUTLINE_BLANK_STRIP, "").trim();
  const isBoldMdLine =
    /^\*\*[^*]+\*\*$/.test(t) ||
    /^__[^_]+__$/.test(t);
  if (isBoldMdLine) return 3;
  return 1;
}

/** At most one outline marker per markdown line (prevents gap implicit + bold-only hint counting as two sections). */
function dedupeMaxPriorityMarkerPerLine(doc: string, markers: HeadingMarker[]): HeadingMarker[] {
  const sorted = [...markers].sort((a, b) => a.from - b.from);
  type Entry = { m: HeadingMarker; p: number };
  const byLine = new Map<number, Entry>();
  for (const m of sorted) {
    const lineIdx = lineIndexAtDocOffset(doc, m.from);
    const p = outlineMarkerPriority(m, doc);
    const prev = byLine.get(lineIdx);
    if (!prev || p > prev.p) {
      byLine.set(lineIdx, { m, p });
    } else if (prev && p === prev.p && m.from < prev.m.from) {
      byLine.set(lineIdx, { m, p });
    }
  }
  return [...byLine.values()]
    .map((e) => e.m)
    .sort((a, b) => a.from - b.from);
}

/**
 * Implicit L2 markers with the same normalized title can repeat on nearby lines (gap + bold hint skew, or
 * non-consecutive `from` with other markers between). Collapse within a small line/char window; keep higher priority.
 */
function dedupeImplicitSameTitleProximity(
  doc: string,
  markers: HeadingMarker[],
  maxLineGap: number,
  maxCharGap: number,
): HeadingMarker[] {
  const sorted = [...markers].sort((a, b) => a.from - b.from);
  const out: HeadingMarker[] = [];
  const norm = (s: string) => s.replace(OUTLINE_BLANK_STRIP, "").trim().toLowerCase();
  const implicitL2 = (m: HeadingMarker) => Boolean(m.implicit && m.level === 2);

  outer: for (const m of sorted) {
    if (!implicitL2(m)) {
      out.push(m);
      continue;
    }
    for (let i = out.length - 1; i >= 0; i--) {
      const o = out[i];
      if (!implicitL2(o)) continue;
      if (norm(o.title) !== norm(m.title)) continue;
      const lo = lineIndexAtDocOffset(doc, o.from);
      const lm = lineIndexAtDocOffset(doc, m.from);
      if (Math.abs(lo - lm) > maxLineGap) continue;
      if (Math.abs(o.from - m.from) > maxCharGap) continue;
      const po = outlineMarkerPriority(o, doc);
      const pm = outlineMarkerPriority(m, doc);
      if (pm > po || (pm === po && m.from < o.from)) {
        out[i] = m;
      }
      continue outer;
    }
    out.push(m);
  }
  return out;
}

function postProcessOutlineMarkers(doc: string, markers: HeadingMarker[]): HeadingMarker[] {
  const sameTitle = dedupeMarkersSameLineSameTitle(doc, markers);
  const perLine = dedupeMaxPriorityMarkerPerLine(doc, sameTitle);
  return dedupeImplicitSameTitleProximity(doc, perLine, 8, 2000);
}

function markersToDocSections(deduped: HeadingMarker[], doc: string): DocSection[] {
  /** Flat outline chunks: each section runs until the next outline marker (matches sidebar + highlights). */
  const sections: DocSection[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const h = deduped[i];
    const start = h.from;
    const end = i + 1 < deduped.length ? deduped[i + 1].from : doc.length;
    const id =
      h.line >= 0 ? `sec-${h.line}-${h.level}${h.implicit ? "i" : ""}` : `sec-hint-${h.from}-${h.level}i`;
    sections.push({
      id,
      title: h.title,
      level: h.level,
      from: start,
      to: end,
      content: doc.slice(start, end),
    });
  }

  return sections;
}

/**
 * Parse sections from markdown: ATX headings plus “implicit” titles
 * (standalone line after a break, short, no list/hr markers; optional body or EOF).
 */
export function getSectionsFromText(doc: string): DocSection[] {
  const { deduped: raw } = collectHeadingMarkersFromMarkdown(doc);
  const deduped = postProcessOutlineMarkers(doc, raw);

  if (deduped.length === 0) {
    return [
      {
        id: "doc-root",
        title: "(Document)",
        level: 0,
        from: 0,
        to: doc.length,
        content: doc,
      },
    ];
  }

  return markersToDocSections(deduped, doc);
}

/** Same as getSectionsFromText but merges WYSIWYG bold-only paragraphs that omit `**` in the string. */
export function getSectionsFromTextWithBoldBlockHints(doc: string, hints: OutlineBoldBlockHint[]): DocSection[] {
  const { deduped: d0 } = collectHeadingMarkersFromMarkdown(doc);
  const merged = mergeBoldBlockHints(d0, hints, doc);
  const afterPost = postProcessOutlineMarkers(doc, merged);

  const deduped: HeadingMarker[] = [];
  const seenFrom = new Set<number>();
  for (const mk of afterPost) {
    if (seenFrom.has(mk.from)) continue;
    seenFrom.add(mk.from);
    deduped.push(mk);
  }

  if (deduped.length === 0) {
    return [
      {
        id: "doc-root",
        title: "(Document)",
        level: 0,
        from: 0,
        to: doc.length,
        content: doc,
      },
    ];
  }

  return markersToDocSections(deduped, doc);
}

export function getSectionAtPos(sections: DocSection[], pos: number): DocSection | null {
  for (const s of sections) {
    if (pos >= s.from && pos < s.to) return s;
  }
  return sections.length ? sections[sections.length - 1] : null;
}

function normOutlineTitleKey(s: string): string {
  return s.replace(OUTLINE_BLANK_STRIP, "").trim().toLowerCase();
}

/**
 * Map a top-level editor block to its outline section. Prefer this over {@link getSectionAtPos} when
 * `blockStartOffset` comes from Plate serialization: it can drift a few characters from line-based
 * `DocSection.from`, so the offset may still fall in the *previous* section for heading blocks.
 * Heading blocks are matched by normalized title; duplicate titles fall back to nearest `from` in a small window.
 */
export function getSectionForEditorBlock(
  sections: DocSection[],
  blockStartOffset: number,
  block: { type?: string } | undefined,
  headingPlainText: string,
): DocSection | null {
  const hl = headingLevelFromType(block?.type);
  if (hl > 0 && headingPlainText.replace(OUTLINE_BLANK_STRIP, "").trim().length > 0) {
    const ht = normOutlineTitleKey(headingPlainText);
    const candidates = sections.filter((s) => s.level > 0 && normOutlineTitleKey(s.title) === ht);
    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length > 1) {
      const windowed = candidates.filter(
        (s) => blockStartOffset >= s.from - 12 && blockStartOffset < s.to + 12,
      );
      windowed.sort((a, b) => Math.abs(blockStartOffset - a.from) - Math.abs(blockStartOffset - b.from));
      if (windowed[0]) return windowed[0]!;
    }
  }
  return getSectionAtPos(sections, blockStartOffset);
}

/**
 * Score sections by keyword overlap with a query string.
 * Returns the top N sections by score (ignoring sections with score 0).
 */
export function findRelevantSections(
  query: string,
  sections: DocSection[],
  topN = 3,
): DocSection[] {
  const stopWords = new Set([
    "a", "an", "the", "is", "it", "in", "on", "at", "to", "do", "for",
    "of", "and", "or", "but", "not", "with", "this", "that", "be", "was",
    "are", "can", "has", "have", "i", "you", "we", "me", "my", "your",
    "write", "make", "create", "generate", "update", "change", "add", "edit",
  ]);

  const tokenize = (text: string): string[] =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  const scored = sections
    .filter((s) => s.level > 0)
    .map((s) => {
      const tokens = tokenize(s.title + " " + s.content.slice(0, 800));
      let score = 0;
      for (const t of tokens) {
        if (queryTokens.has(t)) score++;
      }
      // Bonus for title matches
      const titleTokens = new Set(tokenize(s.title));
      for (const t of queryTokens) {
        if (titleTokens.has(t)) score += 2;
      }
      return { section: s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return scored.map((x) => x.section);
}

/** Match trailing trim: prefix-serialization `blockStarts` vs line-based `DocSection.from` can skew slightly. */
const SECTION_TRIM_MD_SLACK = 4;

/**
 * Trim a block span so it doesn't bleed into adjacent sections.
 *
 * `blockStarts` comes from prefix serialization while `docSections` uses full-doc offsets.
 * The two offset systems can drift by a few chars: overlap logic may include the **last** block of
 * the previous section (leading false positive) or the **first** block of the next section (trailing).
 * This removes those blocks; see {@link SECTION_TRIM_MD_SLACK}.
 */
export function trimBlockSpanToSection(
  b0: number,
  b1: number,
  blocks: Array<{ type?: string }>,
  blockStarts: number[],
  sec: DocSection,
  allSections: DocSection[],
): [number, number] {
  // Drop leading blocks before `sec.from`, including when drift makes the block "end" just past `sec.from`.
  while (b0 < b1) {
    const start = blockStarts[b0] ?? 0;
    const end = blockStarts[b0 + 1] ?? 0;
    if (end <= sec.from) {
      b0++;
      continue;
    }
    if (start < sec.from && end <= sec.from + SECTION_TRIM_MD_SLACK) {
      b0++;
      continue;
    }
    break;
  }
  while (b1 > b0) {
    if (headingLevelFromType(blocks[b1]?.type) > 0) {
      b1--;
      continue;
    }
    const bOff = blockStarts[b1] ?? 0;
    const isOtherSectionStart = allSections.some(
      (s) => s.from !== sec.from && s.level > 0 && Math.abs(s.from - bOff) <= SECTION_TRIM_MD_SLACK,
    );
    if (isOtherSectionStart) {
      b1--;
      continue;
    }
    break;
  }
  return [b0, b1];
}

/** Build a flat (single-level) outline from sections — no nesting. */
export function buildOutline(sections: DocSection[]): OutlineNode[] {
  return sections
    .filter((s) => s.level > 0)
    .map((s) => ({
      id: s.id,
      title: s.title,
      level: s.level,
      from: s.from,
      children: [],
    }));
}
