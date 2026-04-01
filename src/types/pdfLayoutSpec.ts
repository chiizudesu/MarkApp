export type PdfLayoutCalloutKind = "note" | "highlight" | "summary";

/** Visual only; does not change text. Default in renderer: level 1 = accent_bar, 2–3 = pill. */
export type PdfHeadingStyle = "plain" | "pill" | "accent_bar";

/** Visual only. Default in renderer: cards (rich). Use plain for dense lists. */
export type PdfListStyle = "plain" | "pills" | "cards";

export type PdfLayoutBlock =
  | { type: "title"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string; style?: PdfHeadingStyle }
  | { type: "paragraph"; text: string; variant?: "normal" | "lead" }
  | { type: "bullets"; items: string[]; style?: PdfListStyle }
  /** GitHub-style pipe tables only: same column count in every row; cell text must be verbatim from the table. */
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "callout"; kind: PdfLayoutCalloutKind; title?: string; body: string }
  | { type: "divider" };

export type PdfLayoutSpec = {
  meta: { title: string; accentColor: string };
  blocks: PdfLayoutBlock[];
};

const CALLOUT_KINDS = new Set<PdfLayoutCalloutKind>(["note", "highlight", "summary"]);
const HEADING_STYLES = new Set<PdfHeadingStyle>(["plain", "pill", "accent_bar"]);
const LIST_STYLES = new Set<PdfListStyle>(["plain", "pills", "cards"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function parseBlock(raw: unknown): PdfLayoutBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const t = o.type;
  if (t === "title" && isNonEmptyString(o.text)) return { type: "title", text: o.text.trim() };
  if (t === "heading") {
    const level = o.level;
    const text = o.text;
    if ((level === 1 || level === 2 || level === 3) && isNonEmptyString(text)) {
      const st = o.style;
      const style =
        typeof st === "string" && HEADING_STYLES.has(st as PdfHeadingStyle) ? (st as PdfHeadingStyle) : undefined;
      return { type: "heading", level, text: text.trim(), ...(style ? { style } : {}) };
    }
    return null;
  }
  if (t === "paragraph" && isString(o.text)) {
    const v = o.variant;
    const variant = v === "lead" ? ("lead" as const) : undefined;
    return { type: "paragraph", text: o.text, ...(variant ? { variant } : {}) };
  }
  if (t === "bullets" && Array.isArray(o.items)) {
    const items = o.items.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (items.length === 0) return null;
    const st = o.style;
    const style =
      typeof st === "string" && LIST_STYLES.has(st as PdfListStyle) ? (st as PdfListStyle) : undefined;
    return { type: "bullets", items: items.map((s) => s.trim()), ...(style ? { style } : {}) };
  }
  if (t === "table" && Array.isArray(o.headers) && Array.isArray(o.rows)) {
    const headers = o.headers.map((h) => (typeof h === "string" ? h : String(h ?? "")));
    const n = headers.length;
    if (n < 1) return null;
    const rows: string[][] = [];
    for (const row of o.rows) {
      if (!Array.isArray(row)) return null;
      const cells = row.map((c) => (typeof c === "string" ? c : String(c ?? "")));
      if (cells.length !== n) return null;
      rows.push(cells);
    }
    return { type: "table", headers, rows };
  }
  if (t === "callout" && isString(o.body)) {
    const kind = o.kind;
    if (typeof kind !== "string" || !CALLOUT_KINDS.has(kind as PdfLayoutCalloutKind)) return null;
    const title = o.title;
    return {
      type: "callout",
      kind: kind as PdfLayoutCalloutKind,
      body: o.body,
      ...(typeof title === "string" && title.trim() ? { title: title.trim() } : {}),
    };
  }
  if (t === "divider") return { type: "divider" };
  return null;
}

/** Parse and validate AI JSON into a layout spec. Throws with a short message on failure. */
export function parsePdfLayoutSpecFromAiJson(rawText: string): PdfLayoutSpec {
  const trimmed = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("AI PDF layout was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("AI PDF layout: expected an object.");
  const root = parsed as Record<string, unknown>;
  const meta = root.meta;
  if (!meta || typeof meta !== "object") throw new Error("AI PDF layout: missing meta.");
  const m = meta as Record<string, unknown>;
  if (!isNonEmptyString(m.title)) throw new Error("AI PDF layout: meta.title required.");
  if (!isNonEmptyString(m.accentColor)) throw new Error("AI PDF layout: meta.accentColor required.");
  const hex = m.accentColor.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    throw new Error("AI PDF layout: meta.accentColor must be #RRGGBB.");
  }
  if (!Array.isArray(root.blocks)) throw new Error("AI PDF layout: blocks must be an array.");
  const blocks: PdfLayoutBlock[] = [];
  for (const b of root.blocks) {
    const pb = parseBlock(b);
    if (pb) blocks.push(pb);
  }
  if (blocks.length === 0) throw new Error("AI PDF layout: no valid blocks.");
  return { meta: { title: m.title.trim(), accentColor: hex }, blocks };
}
