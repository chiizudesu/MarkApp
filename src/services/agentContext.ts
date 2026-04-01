import { buildAgentUserPayload } from "@/services/claude";
import type { DocSection } from "@/services/sectionService";

/** Tier A/B context budgets (characters) — full doc and per-section caps before sending to the model. */
export const AGENT_DOC_CHAR_BUDGET = 200_000;
export const AGENT_SECTION_CHAR_BUDGET = 50_000;

export type AgentContextSection = {
  id: string;
  title: string;
  content: string;
  from?: number;
  to?: number;
};

export type BuildTieredAgentPayloadParams = {
  instruction: string;
  fullDocument: string;
  sections: AgentContextSection[];
  documentSections?: DocSection[];
  mentionDocument?: boolean;
  mentionClipboard?: string | null;
  /** True when the app will paste the full assistant reply into the editor (single pin or blank doc). */
  directEditorOutput?: boolean;
};

function truncateDoc(md: string): { text: string; note: string | null } {
  if (md.length <= AGENT_DOC_CHAR_BUDGET) return { text: md, note: null };
  return {
    text:
      md.slice(0, AGENT_DOC_CHAR_BUDGET) +
      "\n\n<!-- MarkApp: document truncated for context budget; edit earlier regions or pin specific sections. -->\n",
    note: "truncated-document",
  };
}

function truncateSections(list: AgentContextSection[]): AgentContextSection[] {
  return list.map((s) => {
    if (s.content.length <= AGENT_SECTION_CHAR_BUDGET) return s;
    return {
      ...s,
      content:
        s.content.slice(0, AGENT_SECTION_CHAR_BUDGET) +
        "\n\n<!-- MarkApp: section body truncated for context budget. -->\n",
    };
  });
}

/**
 * Assembles the same user payload as {@link buildAgentUserPayload} with Tier A/B size limits
 * so long documents do not blow context windows silently.
 */
export function buildTieredAgentUserPayload(params: BuildTieredAgentPayloadParams): string {
  const { text, note } = truncateDoc(params.fullDocument);
  const sections = truncateSections(params.sections);
  const base = buildAgentUserPayload({
    instruction: params.instruction,
    fullDocument: text,
    sections,
    documentSections: params.documentSections,
    mentionDocument: params.mentionDocument,
    mentionClipboard: params.mentionClipboard,
    directEditorOutput: params.directEditorOutput,
  });
  if (!note) return base;
  return `--- CONTEXT NOTE (MarkApp) ---\nThe current document was truncated to ${AGENT_DOC_CHAR_BUDGET} characters for the model context budget.\n\n${base}`;
}
