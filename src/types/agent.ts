export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Present when this assistant message proposes replacing a single section. */
  sectionProposal?: { oldText: string; newText: string };
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
