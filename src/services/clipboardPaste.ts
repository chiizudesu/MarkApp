/** Max HTML clipboard payload before we refuse conversion and paste plain only. */
export const MAX_HTML_CLIPBOARD_BYTES = 512 * 1024;

export type PasteRichClassification = "plain" | "rich" | "oversized";

export type ClipboardTextSnapshot = {
  plain: string;
  html: string | null;
};

const OFFICE_OR_EXCEL_RE = /mso-|xmlns:o|xmlns:v|excel\.sheet|word\.document|office:word/i;

const BLOCK_OR_SEMANTIC_TAG_RE =
  /<(table|thead|tbody|tfoot|tr|td|th|ul|ol|li|h[1-6]|blockquote|pre|hr)(\s|>|\/)/i;

const INLINE_FORMAT_TAG_RE = /<(strong|b|em|i|u|del|s|strike|a\s|code)(\s|>)/i;

/** CF_HTML-style comments many apps include. */
const START_FRAG = /<!--\s*StartFragment\s*-->/i;
const END_FRAG = /<!--\s*EndFragment\s*-->/i;

export function normalizeClipboardText(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Prefer the fragment region when present (Word, some browsers), else full HTML.
 */
export function extractClipboardHtmlFragment(html: string): string {
  const start = html.search(START_FRAG);
  const end = html.search(END_FRAG);
  if (start >= 0 && end > start) {
    const body = html.slice(start + html.match(START_FRAG)![0].length, end);
    if (body.trim()) return body;
  }
  return html;
}

export function htmlToPlainText(html: string): string {
  if (typeof document === "undefined") return "";
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent ?? el.innerText ?? "";
}

/**
 * Classify clipboard for paste UX: plain-only, rich (show keep/discard), or oversized HTML.
 */
export function classifyClipboardRichness(snapshot: ClipboardTextSnapshot): PasteRichClassification {
  const html = snapshot.html?.trim() ? snapshot.html : null;
  if (!html) return "plain";
  if (html.length > MAX_HTML_CLIPBOARD_BYTES) return "oversized";

  const fragment = extractClipboardHtmlFragment(html);
  if (OFFICE_OR_EXCEL_RE.test(fragment) || BLOCK_OR_SEMANTIC_TAG_RE.test(fragment)) {
    return "rich";
  }
  if (INLINE_FORMAT_TAG_RE.test(fragment)) {
    const plainNorm = normalizeClipboardText(snapshot.plain);
    const fromHtml = normalizeClipboardText(htmlToPlainText(fragment));
    if (plainNorm !== fromHtml) return "rich";
    if (/<(strong|b|em|i|u)\b/i.test(fragment)) return "rich";
  }

  const plainNorm = normalizeClipboardText(snapshot.plain);
  const fromHtml = normalizeClipboardText(htmlToPlainText(fragment));
  if (plainNorm.length === 0 && fromHtml.length > 0) return "rich";
  if (fromHtml.length > plainNorm.length * 1.15 || plainNorm.length > fromHtml.length * 1.15) {
    return "rich";
  }

  return "plain";
}

export function snapshotFromDataTransfer(dt: DataTransfer): ClipboardTextSnapshot {
  const plain = dt.getData("text/plain") ?? "";
  const htmlRaw = dt.getData("text/html");
  const html = htmlRaw?.trim() ? htmlRaw : null;
  return { plain, html };
}

/**
 * Read plain + HTML from async clipboard API (context menu paste, etc.).
 */
export async function readClipboardSnapshotAsync(): Promise<ClipboardTextSnapshot> {
  let plain = "";
  let html: string | null = null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes("text/html")) {
        const blob = await item.getType("text/html");
        const t = await blob.text();
        if (t?.trim()) html = t;
      }
      if (item.types.includes("text/plain")) {
        const blob = await item.getType("text/plain");
        const t = await blob.text();
        if (t != null && t.length > 0) plain = plain || t;
      }
    }
  } catch {
    /* fall through */
  }
  if (!plain.trim() && !html?.trim()) {
    try {
      plain = await navigator.clipboard.readText();
    } catch {
      /* ignore */
    }
  }
  return { plain, html };
}

export type PasteDefaultRichHandling = "ask" | "plain" | "markdown";

export function parsePasteDefaultRichHandling(raw: unknown): PasteDefaultRichHandling {
  if (raw === "plain" || raw === "markdown" || raw === "ask") return raw;
  return "ask";
}
