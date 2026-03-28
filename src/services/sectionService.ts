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
 * Parse sections from markdown: ATX headings plus “implicit” titles
 * (standalone line after a break, short, no list/hr markers, prose after).
 */
export function getSectionsFromText(doc: string): DocSection[] {
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

    const t = line.trim();
    if (t.length < 2 || t.length > 88) continue;
    if (/^[#>`|]/.test(t)) continue;
    if (/^[-*+]\s/.test(t)) continue;
    if (/^\d+\.\s/.test(t)) continue;
    if (/[.,;:!?]$/.test(t)) continue;
    if (i > 0 && lines[i - 1].trim() !== "") continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j >= lines.length) continue;

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

  const sections: DocSection[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const h = deduped[i];
    const start = h.from;
    let end = doc.length;
    for (let j = i + 1; j < deduped.length; j++) {
      if (deduped[j].level <= h.level) {
        end = deduped[j].from;
        break;
      }
    }
    sections.push({
      id: `sec-${h.line}-${h.level}${h.implicit ? "i" : ""}`,
      title: h.title,
      level: h.level,
      from: start,
      to: end,
      content: doc.slice(start, end),
    });
  }

  return sections;
}

export function getSectionAtPos(sections: DocSection[], pos: number): DocSection | null {
  for (const s of sections) {
    if (pos >= s.from && pos < s.to) return s;
  }
  return sections.length ? sections[sections.length - 1] : null;
}

/** Build hierarchical outline from sections (heading list only). */
export function buildOutline(sections: DocSection[]): OutlineNode[] {
  const nodes = sections.filter((s) => s.level > 0);
  if (nodes.length === 0) return [];
  const root: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const s of nodes) {
    const node: OutlineNode = {
      id: s.id,
      title: s.title,
      level: s.level,
      from: s.from,
      children: [],
    };
    while (stack.length && stack[stack.length - 1].level >= s.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return root;
}
