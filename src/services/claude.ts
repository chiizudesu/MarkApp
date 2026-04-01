import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { requireMarkAPI } from "@/services/markApi";
import { formatDocumentOutlineForAgent, type DocSection } from "@/services/sectionService";
import { parsePdfLayoutSpecFromAiJson, type PdfLayoutSpec } from "@/types/pdfLayoutSpec";

/** Used when Settings has no stored model (empty store / first run). */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

/** Prior defaults / old Haiku id → migrate existing installs to {@link DEFAULT_CLAUDE_MODEL}. */
const LEGACY_AGENT_MODEL_IDS = new Set([
  "claude-sonnet-4-20250514",
  "claude-3-5-haiku-20241022",
]);

export function normalizeStoredClaudeModel(stored: string | undefined): string {
  const t = stored?.trim();
  if (!t || LEGACY_AGENT_MODEL_IDS.has(t)) return DEFAULT_CLAUDE_MODEL;
  return t;
}

async function getKey(): Promise<string> {
  const key = (await requireMarkAPI().getStore("anthropicApiKey")) as string | undefined;
  if (!key?.trim()) throw new Error("Anthropic API key not set. Open Settings.");
  return key.trim();
}

async function getModel(): Promise<string> {
  const m = (await requireMarkAPI().getStore("claudeModel")) as string | undefined;
  return normalizeStoredClaudeModel(m);
}

/** Minimal request to verify API key + model (Settings “Test”). */
export async function testAnthropicConnection(apiKey: string, model: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) throw new Error("Enter an API key first.");
  const m = model.trim() || DEFAULT_CLAUDE_MODEL;
  const c = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  await c.messages.create({
    model: m,
    max_tokens: 4,
    messages: [{ role: "user", content: "Hi" }],
  });
}

const MARKDOWN_AGENT_SYSTEM = `You are a writing assistant inside MarkApp, a markdown editor.
Every message includes --- CURRENT DOCUMENT --- with what is in the editor (it may be empty or a single placeholder line like "#"). Do not claim you cannot see the document; use that block and the chat history.

**Direct editor output:** MarkApp often pastes your **entire** assistant message into the document as markdown—as the body of a single pinned section, as the full document when it is new/empty, or as a whole-file replacement when you produce a complete revised draft. In those situations your reply must be **only** the markdown that belongs in the file: no questions to the user, no “would you like…”, no offers to clarify, no preambles (“Here’s a draft:”), no postscripts, and no meta-commentary. If something is ambiguous, pick the most reasonable interpretation and write the content; do not ask follow-ups in the document stream. Short status lines belong in chat-only turns (see below), not in text that will land in the editor.

When a message includes --- MARKAPP OUTPUT MODE: DIRECT TO EDITOR ---, that rule is mandatory for this turn: output nothing but the file-ready markdown.

When present, --- DOCUMENT OUTLINE (MarkApp) --- lists each logical section: heading level (or preamble before first heading), stable id, title, and character ranges that refer **to the same string** as CURRENT DOCUMENT. Use it for anything about structure: headings, outline, TOC, splitting or merging topics, “optimize/improve/fix sectioning”, hierarchy (# vs ## vs ###), or where a section starts and ends. MarkApp treats each ATX heading as starting a section until the next heading at the same or higher level.

Standalone HTML comment lines \`<!--markapp-manual-section-->\` (spacing inside the tag may vary) are **manual section breaks** the author placed. When you output an updated full document or reorganize structure, **keep every such line** on its own line, in order, between the same surrounding content—never delete them unless the user explicitly asks to remove manual section breaks.

For sectioning / outline tasks: propose sensible ##/### structure (avoid skipping levels without reason), one main idea per section, merge duplicates, add headings where the topic clearly shifts, remove orphan or redundant headings, and **preserve the author’s wording** unless they asked to rewrite prose. Output the **complete updated markdown document** when changing structure across the file (same as a full-document edit).

Help refine, structure, or expand the user's document. Prefer clear, concise markdown.
Use **GitHub-Flavored Markdown** for structure: tables as pipe tables (| columns |), never HTML \`<table>\` / \`<div>\` markup. Do not output raw HTML except the manual section-break comment line described above and fenced code blocks when the user needs a literal code sample. Use normal markdown for headings, lists, emphasis, and links.

When the user asks to apply, insert, or use a prior reply in the document, output the full markdown that should appear in the editor (often the same as your last substantive answer), not a refusal.

When the user asks you to rewrite a specific section only, respond with ONLY the replacement markdown for that section — no preamble, no code fences, unless the section itself should contain a fenced block.

For **chat-only** answers (e.g. explaining a concept when no section is pinned and the user did not ask for document text), you may answer in normal markdown prose; those replies are not inserted into the file. Still avoid ending with questions unless the user is clearly in a conversational Q&A turn.`;

/** Appended to the agent system prompt when Settings → “Disallow agent to use code blocks” is on. */
const AGENT_DISALLOW_OUTER_CODE_FENCES = `--- USER PREFERENCE: NO OUTER CODE FENCES ---
Never wrap your entire reply, or the full document or section meant for the MarkApp editor, in markdown code fences (\`\`\` ... \`\`\`). Output raw markdown the editor can ingest directly.
Do not start your message with \`\`\` or \`\`\`markdown. Headings, lists, and paragraphs should be normal markdown lines.
You may use a fenced block only for a genuine code or configuration snippet when the user clearly asks for code—or when reproducing a short literal the document must contain. Do not use fences as a wrapper for ordinary prose.`;

const SECTION_REPLACE_SYSTEM = `You rewrite a markdown SECTION. Output ONLY the new section text (including its heading line if one should remain). No explanations, no questions, no markdown fences around the whole response. Use GFM markdown only (pipe tables if you need a table, not HTML tags). If the instruction is ambiguous, choose the best interpretation and write the section—do not ask the user for clarification in your output.`;

const AUTO_SECTION_SYSTEM = `You structure plain markdown by adding ## section headings only. Split the text into clear topical sections. Preserve all original wording and paragraph breaks; insert heading lines (## Title) where appropriate and blank lines around headings.

MarkApp manual section breaks are standalone HTML comment lines exactly: <!--markapp-manual-section--> (only spacing inside <!-- ... --> may vary). You MUST keep every such line in the output, on its own line, in the same order and in the same relative positions between paragraphs—never delete or merge across them.

Output the complete markdown document only—no preamble or explanation, no wrapping code fences.`;

export async function streamChat(
  system: string,
  messages: MessageParam[],
  onChunk: (t: string) => void,
): Promise<string> {
  const apiKey = await getKey();
  const model = await getModel();
  const c = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let out = "";
  const stream = await c.messages.stream({
    model,
    max_tokens: 8192,
    system,
    messages,
  });
  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      out += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }
  return out;
}

export async function streamAgentTurn(
  messages: MessageParam[],
  onChunk: (t: string) => void,
  options?: { systemSuffix?: string; disallowCodeBlocks?: boolean },
): Promise<string> {
  let system = MARKDOWN_AGENT_SYSTEM;
  if (options?.disallowCodeBlocks) {
    system += `\n\n${AGENT_DISALLOW_OUTER_CODE_FENCES}`;
  }
  const suffix = options?.systemSuffix?.trim();
  if (suffix && suffix.length > 0) {
    system += `\n\n--- USER / APPENDED INSTRUCTIONS ---\n${suffix}`;
  }
  return streamChat(system, messages, onChunk);
}

/** Insert ## headings into unstructured markdown. */
export async function autoSectionDocument(markdown: string): Promise<string> {
  const trimmed = markdown.trim();
  if (!trimmed) return markdown;
  let out = "";
  await streamChat(
    AUTO_SECTION_SYSTEM,
    [
      {
        role: "user",
        content: `Add section headings to this document:\n\n${markdown.slice(0, 50000)}`,
      },
    ],
    (c) => {
      out += c;
    },
  );
  return out.trim();
}

export async function streamSectionReplace(
  sectionMarkdown: string,
  instruction: string,
  onChunk: (t: string) => void,
): Promise<string> {
  const apiKey = await getKey();
  const model = await getModel();
  const c = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let out = "";
  const stream = await c.messages.stream({
    model,
    max_tokens: 8192,
    system: SECTION_REPLACE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `SECTION:\n${sectionMarkdown}\n\nINSTRUCTION:\n${instruction}`,
          },
        ],
      },
    ],
    temperature: 0.3,
  });
  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      out += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }
  return out;
}

export async function fillPlaceholdersWithAI(
  templateBody: string,
  userBrief: string,
  placeholderNames: string[],
  onChunk: (t: string) => void,
): Promise<Record<string, string>> {
  const apiKey = await getKey();
  const model = await getModel();
  const c = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const sys = `You fill template placeholders. Respond with ONLY valid JSON object mapping placeholder keys to string values. Keys: ${JSON.stringify(placeholderNames)}`;
  let raw = "";
  const stream = await c.messages.stream({
    model,
    max_tokens: 4096,
    system: sys,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Template (excerpt):\n${templateBody.slice(0, 12000)}\n\nUser brief:\n${userBrief}`,
          },
        ],
      },
    ],
    temperature: 0.2,
  });
  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      raw += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as Record<string, string>;
  } catch {
    throw new Error("Could not parse AI placeholder JSON");
  }
}

const PDF_LAYOUT_SYSTEM = `You map markdown into a JSON print layout for PDF generation. Output ONLY valid JSON (no markdown fences, no commentary).

**Content fidelity (critical):**
- Copy all user-facing text **verbatim** from the markdown into JSON string fields. Do **not** paraphrase, summarize, tighten, expand, explain, or add sentences, bullets, headings, labels, or callouts that are not in the source.
- **Forbidden output patterns (the app renders real structure — never replace the doc with a synopsis):** Do not use titles or headings like "Summary of the document", "Overview", "Synopsis", or framing like "This document covers:" / "This guide covers:" unless that **exact** phrase appears in the source. Do not collapse the document into a short bullet list of topic blurbs. Do not add editorial paragraphs about "structural issues", code fences, or what "should be cleaned up" unless that text is literally in the file.
- Do **not** output "callout" blocks.
- **meta.title** = exact text of the first # heading if any, else first non-empty source line, else "Untitled". **meta.accentColor** = #RRGGBB only (visual).
- Strip markdown **syntax** only: remove # but keep heading text exactly; unwrap ** / * / \` without changing words; link label text verbatim (omit URL unless shown as text in source).
- Preserve **document order** and **approximate block count**: each source heading → one "heading"; each paragraph → "paragraph"; each list → "bullets" with one string per list item (full item text verbatim, not a shortened description).

**Visual hints (optional JSON fields — change presentation only, never wording):**
- "heading" may include "style": "pill" | "accent_bar" | "plain". Prefer "pill" for ##/### and "accent_bar" for # when it fits the source hierarchy. Use "plain" only for dense reference-style sections.
- "bullets" may include "style": "pills" | "cards" | "plain". Use "pills" when many items match "Label – rest" / "Label - rest" / "Label: rest" patterns (same characters as in source). Use "cards" for other lists. Use "plain" only if the list is extremely long and tight.
- "paragraph" may include "variant": "lead" for the opening paragraph immediately after the title when it is a normal intro paragraph in the source (not for headings).

**Structure:**
- Start with one "title" block equal to meta.title (verbatim).
- Mirror the markdown in order: headings, paragraphs, lists, tables, dividers as they appear.
- "divider" only for --- or *** on its own line in the source.
- **Tables:** pipe tables → { "type":"table","headers":[],"rows":[] } with verbatim cells; same column counts; only structural exception allowed.

**Truncated input:** Map only the excerpt verbatim; do not invent endings.

**JSON shape:** { "meta": { "title": string, "accentColor": "#RRGGBB" }, "blocks": Block[] }
Block = { "type":"title","text":string } | { "type":"heading","level":1|2|3,"text":string,"style"?:string } | { "type":"paragraph","text":string,"variant"?:string } | { "type":"bullets","items":string[],"style"?:string } | { "type":"table","headers":string[],"rows":string[][] } | { "type":"divider" }
Never use "callout". "blocks" must be non-empty.`;

const CHANGE_SUMMARY_SYSTEM = `You summarize edits made to a markdown section. Return ONLY a JSON array of ≤5 short strings, each describing one concrete change (e.g. "Tightened the opening sentence", "Added detail on X"). No intro text, no markdown, no keys — just the raw JSON array.`;

const PDF_LAYOUT_INPUT_MAX_CHARS = 50_000;

/** Turn markdown into a validated PDF layout spec (for pdf-lib rendering). */
export async function generatePdfLayoutFromMarkdown(markdown: string): Promise<PdfLayoutSpec> {
  const trimmed = markdown.trim();
  if (!trimmed) throw new Error("Document is empty.");

  const excerpt =
    trimmed.length > PDF_LAYOUT_INPUT_MAX_CHARS ? trimmed.slice(0, PDF_LAYOUT_INPUT_MAX_CHARS) : trimmed;
  const truncated = trimmed.length > PDF_LAYOUT_INPUT_MAX_CHARS;

  const apiKey = await getKey();
  const model = await getModel();
  const c = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const userText = truncated
    ? `The following markdown may be truncated to the first ${PDF_LAYOUT_INPUT_MAX_CHARS} characters. Map it to JSON layout with **verbatim** text only (see system rules). Do not invent content.\n\n---\n\n${excerpt}`
    : `Map the following markdown to the JSON layout with **verbatim** text only. Do not invent content.\n\n---\n\n${excerpt}`;

  const resp = await c.messages.create({
    model,
    max_tokens: 16384,
    system: PDF_LAYOUT_SYSTEM,
    messages: [{ role: "user", content: userText }],
    temperature: 0.15,
  });
  const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  return parsePdfLayoutSpecFromAiJson(raw);
}

/** Returns up to 5 bullet strings summarising what changed between oldText → newText. Never throws (returns [] on error). */
export async function summarizeSectionChanges(
  oldText: string,
  newText: string,
  sectionTitle: string,
): Promise<string[]> {
  try {
    const apiKey = await getKey();
    const model = await getModel();
    const c = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const resp = await c.messages.create({
      model,
      max_tokens: 300,
      system: CHANGE_SUMMARY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Section: "${sectionTitle}"\n\nBEFORE:\n${oldText.slice(0, 6000)}\n\nAFTER:\n${newText.slice(0, 6000)}`,
        },
      ],
      temperature: 0.2,
    });
    const raw = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "[]";
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (Array.isArray(parsed)) return (parsed as unknown[]).slice(0, 5).map(String);
    return [];
  } catch {
    return [];
  }
}

/** When true, the app will paste the assistant’s full reply into the editor (single pin or blank doc). */
export const MARKAPP_DIRECT_EDITOR_BANNER = `--- MARKAPP OUTPUT MODE: DIRECT TO EDITOR ---
Your entire reply for this turn is written into the document verbatim. Output only markdown that belongs in the file: no questions, no conversational wrappers, no “let me know”.`;

export function buildAgentUserPayload(parts: {
  instruction: string;
  fullDocument: string;
  sections: Array<{ id: string; title: string; content: string }>;
  /** Parsed outline for the same document; drives DOCUMENT OUTLINE so the model is section-aware. */
  documentSections?: DocSection[];
  mentionDocument?: boolean;
  mentionClipboard?: string | null;
  /** Single pinned section or blank document: full assistant message replaces editor content. */
  directEditorOutput?: boolean;
}): string {
  const blocks: string[] = [];
  if (parts.directEditorOutput) {
    blocks.push(MARKAPP_DIRECT_EDITOR_BANNER);
  }
  const docLabel = parts.mentionDocument
    ? "--- FULL DOCUMENT (@document) ---"
    : "--- CURRENT DOCUMENT ---";
  blocks.push(docLabel + "\n" + parts.fullDocument);
  if (parts.documentSections && parts.documentSections.length > 0) {
    blocks.push(
      "--- DOCUMENT OUTLINE (MarkApp) ---\n" + formatDocumentOutlineForAgent(parts.documentSections),
    );
  }
  for (const s of parts.sections) {
    blocks.push(`--- SECTION ${s.id}: ${s.title} ---\n${s.content}`);
  }
  if (parts.mentionClipboard) {
    blocks.push("--- CLIPBOARD ---\n" + parts.mentionClipboard);
  }
  blocks.push("--- USER REQUEST ---\n" + parts.instruction);
  return blocks.join("\n\n");
}
