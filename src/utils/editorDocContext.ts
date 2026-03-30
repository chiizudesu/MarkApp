import type { ChatMessage } from "@/types/agent";
import { stripOuterMarkdownCodeFence } from "@/utils/markdownFence";

/** Shipped welcome text — treat as empty for “draft applies to new doc”. */
export const MARKAPP_DEFAULT_STARTER_DOC = "# Hello\n\nStart writing in **MarkApp**.\n";

/**
 * Document is empty or only a placeholder (new file, single “#” line, welcome stub).
 * Used so the first substantive assistant reply can auto-apply to the editor.
 */
export function isEffectivelyBlankDocument(markdown: string): boolean {
  const t = markdown.trim();
  if (!t) return true;
  const n = t.replace(/\r\n/g, "\n");
  const lines = n.split("\n").map((l) => l.trimEnd());
  const nonEmpty = lines.filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return true;
  if (nonEmpty.length === 1 && /^#\s*$/.test(nonEmpty[0])) return true;
  const starter = MARKAPP_DEFAULT_STARTER_DOC.trim();
  if (n === starter || n === MARKAPP_DEFAULT_STARTER_DOC.replace(/\n$/, "").trim()) return true;
  return false;
}

const APPLY_TO_DOC_RE =
  /\bapply\b[\s\S]{0,40}\b(doc|document)\b|\bput\s+(it|this|that)\s+(in|into)\s+(my\s+|the\s+)?(doc|document)\b|\binsert\b[\s\S]{0,30}\b(in|into)\b[\s\S]{0,20}\b(doc|document)\b/i;

/** User is asking to put the assistant’s last reply into the document. */
export function wantsApplyPriorReplyToDoc(userText: string): boolean {
  const t = userText.trim();
  if (t.length > 160) return false;
  return APPLY_TO_DOC_RE.test(t);
}

/**
 * Whether assistant output is substantive enough to treat as document markdown (vs. a short chat answer).
 */
export function looksLikeAssistantDocumentDraft(text: string): boolean {
  const raw = stripOuterMarkdownCodeFence(text?.trim() ?? "");
  if (raw.length < 120) return false;
  const hasMdHeading = /^#{1,6}\s/m.test(raw);
  const paraBlocks = raw.split(/\n{2,}/).filter(Boolean);
  if (hasMdHeading || paraBlocks.length >= 2) return true;
  if (raw.length > 320) return true;
  return false;
}

/**
 * Best candidate assistant markdown to insert — skips short refusals, prefers real drafts
 * (headings, multiple paragraphs, or long prose).
 */
export function lastAssistantDraft(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const raw = stripOuterMarkdownCodeFence(m.content?.trim() ?? "");
    if (looksLikeAssistantDocumentDraft(raw)) return raw;
  }
  return null;
}
