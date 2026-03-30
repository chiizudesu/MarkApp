export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Present when this assistant message proposes replacing a single section. */
  sectionProposal?: {
    oldText: string;
    newText: string;
    sectionTitle?: string;
    /**
     * Markdown `from` offset of the section heading at the time the proposal was created.
     * Stored so the editor overlay can later find the full new span (the section's `to` may
     * shrink if the AI adds sub-headings, so we walk to the next peer-level heading instead).
     */
    sectionMarkdownFrom?: number;
    /** AI-generated bullet points (≤5) summarising what changed. Populated async after streaming. */
    summary?: string[];
    /** Whether the user accepted (true), reverted (false), or hasn't decided yet (undefined). */
    accepted?: boolean;
  };
}

export interface SectionRef {
  id: string;
  title: string;
  content: string;
  from: number;
  to: number;
}

export interface PendingProposal {
  sectionId: string;
  from: number;
  to: number;
  oldText: string;
  newText: string;
}
