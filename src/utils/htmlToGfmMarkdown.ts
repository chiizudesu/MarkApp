import TurndownService from "turndown";
// Package ships without TypeScript types.
// @ts-expect-error — no @types/turndown-plugin-gfm
import { gfm } from "turndown-plugin-gfm";

import { extractClipboardHtmlFragment, MAX_HTML_CLIPBOARD_BYTES } from "@/services/clipboardPaste";

let turndownSingleton: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (!turndownSingleton) {
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
    });
    td.use(gfm);
    turndownSingleton = td;
  }
  return turndownSingleton;
}

/**
 * Drop script/style and trim Word-ish noise before Turndown.
 */
export function preCleanClipboardHtml(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
  doc.querySelectorAll('[class*="Mso"]').forEach((el) => {
    el.removeAttribute("class");
  });
  return doc.body?.innerHTML ?? html;
}

/** Unclosed angle-bracket runs in output (outside code) suggest failed conversion. */
function hasSuspiciousMarkdownTags(md: string): boolean {
  const lines = md.split("\n");
  let inFence = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    if (/<[a-zA-Z][\w:-]*(\s+[^>]*)?>/.test(line) && !line.includes("`")) {
      if (/<\/?(span|div|p|br|table|tr|td)\b/i.test(line)) return true;
    }
  }
  return false;
}

export type HtmlToGfmResult =
  | { ok: true; markdown: string }
  | { ok: false; markdown: string; reason: string };

/**
 * Convert HTML clipboard payload to GFM markdown for Plate deserialize.
 */
export function htmlToGfmMarkdown(html: string, plainFallback: string): HtmlToGfmResult {
  if (!html?.trim()) {
    return { ok: true, markdown: plainFallback };
  }
  if (html.length > MAX_HTML_CLIPBOARD_BYTES) {
    return { ok: false, markdown: plainFallback, reason: "HTML too large" };
  }

  let fragment = extractClipboardHtmlFragment(html);
  try {
    fragment = preCleanClipboardHtml(fragment);
  } catch {
    /* use raw fragment */
  }

  let markdown = "";
  try {
    markdown = getTurndown().turndown(fragment).trim();
  } catch {
    return { ok: false, markdown: plainFallback, reason: "Conversion failed" };
  }

  if (!markdown && plainFallback.trim()) {
    return { ok: false, markdown: plainFallback, reason: "Empty result" };
  }

  if (hasSuspiciousMarkdownTags(markdown)) {
    return { ok: false, markdown: plainFallback, reason: "Unconverted markup in output" };
  }

  return { ok: true, markdown: markdown || plainFallback };
}
