import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { requireMarkAPI } from "@/services/markApi";

async function getKey(): Promise<string> {
  const key = (await requireMarkAPI().getStore("anthropicApiKey")) as string | undefined;
  if (!key?.trim()) throw new Error("Anthropic API key not set. Open Settings.");
  return key.trim();
}

async function getModel(): Promise<string> {
  const m = (await requireMarkAPI().getStore("claudeModel")) as string | undefined;
  return m?.trim() || "claude-sonnet-4-20250514";
}

/** Minimal request to verify API key + model (Settings “Test”). */
export async function testAnthropicConnection(apiKey: string, model: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) throw new Error("Enter an API key first.");
  const m = model.trim() || "claude-sonnet-4-20250514";
  const c = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  await c.messages.create({
    model: m,
    max_tokens: 4,
    messages: [{ role: "user", content: "Hi" }],
  });
}

const MARKDOWN_AGENT_SYSTEM = `You are a writing assistant inside MarkApp, a markdown editor.
Every message includes --- CURRENT DOCUMENT --- with what is in the editor (it may be empty or a single placeholder line like "#"). Do not claim you cannot see the document; use that block and the chat history.

Help refine, structure, or expand the user's document. Prefer clear, concise markdown.
When the user asks to apply, insert, or use a prior reply in the document, output the full markdown that should appear in the editor (often the same as your last substantive answer), not a refusal.

When the user asks you to rewrite a specific section, respond with ONLY the replacement markdown for that section — no preamble, no code fences, unless the section itself should contain a fenced block.
For general questions, answer normally in markdown.`;

const SECTION_REPLACE_SYSTEM = `You rewrite a markdown SECTION. Output ONLY the new section text (including its heading line if one should remain). No explanations, no markdown fences around the whole response.`;

const AUTO_SECTION_SYSTEM = `You structure plain markdown by adding ## section headings only. Split the text into clear topical sections. Preserve all original wording and paragraph breaks; insert heading lines (## Title) where appropriate and blank lines around headings. Output the complete markdown document only—no preamble or explanation, no wrapping code fences.`;

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
): Promise<string> {
  return streamChat(MARKDOWN_AGENT_SYSTEM, messages, onChunk);
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

const CHANGE_SUMMARY_SYSTEM = `You summarize edits made to a markdown section. Return ONLY a JSON array of ≤5 short strings, each describing one concrete change (e.g. "Tightened the opening sentence", "Added detail on X"). No intro text, no markdown, no keys — just the raw JSON array.`;

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

export function buildAgentUserPayload(parts: {
  instruction: string;
  fullDocument: string;
  sections: Array<{ id: string; title: string; content: string }>;
  mentionDocument?: boolean;
  mentionClipboard?: string | null;
}): string {
  const blocks: string[] = [];
  const docLabel = parts.mentionDocument
    ? "--- FULL DOCUMENT (@document) ---"
    : "--- CURRENT DOCUMENT ---";
  blocks.push(docLabel + "\n" + parts.fullDocument);
  for (const s of parts.sections) {
    blocks.push(`--- SECTION ${s.id}: ${s.title} ---\n${s.content}`);
  }
  if (parts.mentionClipboard) {
    blocks.push("--- CLIPBOARD ---\n" + parts.mentionClipboard);
  }
  blocks.push("--- USER REQUEST ---\n" + parts.instruction);
  return blocks.join("\n\n");
}
