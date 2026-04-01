import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Box, Flex, Dialog, Portal, Button, VStack, Field, Input, Text } from "@chakra-ui/react";
import { useColorMode } from "@/components/ui/color-mode";
import { PlateEditor, type PlateEditorHandle } from "@/components/Editor/PlateEditor";
import { EditorToolbar } from "@/components/Editor/EditorToolbar";
import { TitleBar } from "@/components/Layout/TitleBar";
import { AiPdfExportDialog } from "@/components/Layout/AiPdfExportDialog";
import { StatusBar } from "@/components/Layout/StatusBar";
import { WelcomeScreen } from "@/components/Layout/WelcomeScreen";
import { CommandPalette, type CommandItem } from "@/components/Layout/CommandPalette";
import { DocumentOutline } from "@/components/Layout/DocumentOutline";
import { toaster } from "@/components/ui/toaster";
import { modShortcut, modShiftShortcut } from "@/utils/platform";
import { exportCurrentDocToAiPdf } from "@/services/exportAiPdf";
import {
  FilePlus,
  FolderOpen,
  Save,
  SaveAll,
  PanelRight,
  Sparkles,
  LayoutTemplate,
  Eye,
  Expand,
  Copy,
  ListTree,
  Settings,
} from "lucide-react";
import { AgentPanel } from "@/components/Agent/AgentPanel";
import { QuickAIDialog } from "@/components/Agent/QuickAIDialog";
import { SettingsDialog } from "@/components/Settings/SettingsDialog";
import { TemplatePicker } from "@/components/Templates/TemplatePicker";
import { TemplateManager } from "@/components/Templates/TemplateManager";
import {
  openFileDialog,
  saveFileDialog,
  readTextFile,
  writeTextFile,
  pushRecent,
} from "@/services/documentService";
import {
  getSectionsFromText,
  buildOutline,
  findRelevantSections,
  findDocSectionForOutlineMarkdownFrom,
  hasManualSectionMarkersInMarkdown,
  normOutlineTitleKey,
  type DocSection,
  type OutlineNode,
} from "@/services/sectionService";
import { buildTieredAgentUserPayload } from "@/services/agentContext";
import { findReplacedMarkdownSpan, hashMarkdownSlice } from "@/utils/appliedMarkdownRange";
import {
  streamAgentTurn,
  streamSectionReplace,
  autoSectionDocument,
  summarizeSectionChanges,
} from "@/services/claude";
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { ReactEditor } from "slate-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, SectionRef } from "@/types/agent";
import { normalizeAssistantMarkdownParagraphs, stripOuterMarkdownCodeFence } from "@/utils/markdownFence";
import { sanitizeAssistantMarkdownOutput } from "@/utils/agentMarkdownSanitize";
import {
  classifyClipboardRichness,
  htmlToPlainText,
  readClipboardSnapshotAsync,
} from "@/services/clipboardPaste";
import { htmlToGfmMarkdown } from "@/utils/htmlToGfmMarkdown";
import {
  MARKAPP_DEFAULT_STARTER_DOC,
  isEffectivelyBlankDocument,
  wantsApplyPriorReplyToDoc,
  lastAssistantDraft,
  looksLikeAssistantDocumentDraft,
} from "@/utils/editorDocContext";

async function loadAgentSystemSuffix(): Promise<string | undefined> {
  const api = window.markAPI;
  if (!api) return undefined;
  const custom = String((await api.getStore("agentCustomInstructions")) ?? "").trim();
  const memOn = Boolean(await api.getStore("agentBehavioralMemoryEnabled"));
  const memory = memOn ? String((await api.getStore("agentBehavioralMemory")) ?? "").trim() : "";
  const parts: string[] = [];
  if (custom.length > 0) parts.push(custom);
  if (memory.length > 0) parts.push(`Behavioral memory (user-provided):\n${memory}`);
  const joined = parts.join("\n\n").trim();
  return joined.length > 0 ? joined : undefined;
}

/** True when live markdown slice matches stored section text (handles Plate normalize vs outline slice). */
function markdownSlicesMatchForReplace(docSlice: string, oldText: string): boolean {
  if (docSlice === oldText) return true;
  if (docSlice.trim() === oldText.trim()) return true;
  const a = normalizeAssistantMarkdownParagraphs(docSlice);
  const b = normalizeAssistantMarkdownParagraphs(oldText);
  return a === b;
}

/** Replace one occurrence of needle; when hintIndex is set, pick the match closest to that index. */
function replaceSubstringAtHint(
  haystack: string,
  needle: string,
  replacement: string,
  hintIndex?: number,
): string | null {
  if (!needle) return null;
  const indices: number[] = [];
  let p = 0;
  while (true) {
    const i = haystack.indexOf(needle, p);
    if (i < 0) break;
    indices.push(i);
    p = i + 1;
  }
  if (indices.length === 0) return null;
  const idx =
    hintIndex !== undefined && hintIndex >= 0
      ? indices.reduce((best, cur) =>
          Math.abs(cur - hintIndex) < Math.abs(best - hintIndex) ? cur : best,
        indices[0]!)
      : indices[0]!;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

function resolveProposalMarkdownRange(
  p: NonNullable<ChatMessage["sectionProposal"]>,
  sections: DocSection[],
  liveDoc: string,
): { sectionFrom: number; sectionTo: number } {
  const title = p.sectionTitle ?? "Section";
  if (title === "Document") return { sectionFrom: -1, sectionTo: -1 };

  if (title === "(Selection)") {
    const needles = [
      ...new Set(
        [
          sanitizeAssistantMarkdownOutput(p.newText),
          normalizeAssistantMarkdownParagraphs(p.newText),
          p.newText,
        ].filter((s) => s.length > 0),
      ),
    ];
    let bestIdx = -1;
    let bestLen = 0;
    const hint = p.sectionMarkdownFrom ?? 0;
    for (const needle of needles) {
      let pos = 0;
      while (true) {
        const i = liveDoc.indexOf(needle, pos);
        if (i < 0) break;
        if (bestIdx < 0 || Math.abs(i - hint) < Math.abs(bestIdx - hint)) {
          bestIdx = i;
          bestLen = needle.length;
        }
        pos = i + 1;
      }
    }
    if (bestIdx >= 0 && bestLen > 0) {
      return { sectionFrom: bestIdx, sectionTo: bestIdx + bestLen };
    }
    const sf = p.sectionMarkdownFrom;
    const st = p.sectionMarkdownTo;
    if (sf !== undefined && st !== undefined && st > sf) {
      return { sectionFrom: sf, sectionTo: st };
    }
    return { sectionFrom: -1, sectionTo: -1 };
  }

  const storedFrom = p.sectionMarkdownFrom;
  const titleKey = normOutlineTitleKey(title);

  let startSec =
    storedFrom !== undefined
      ? sections.find((s) => s.level > 0 && s.from === storedFrom)
      : undefined;
  if (!startSec) {
    const sameTitle = sections.filter(
      (s) => s.level > 0 && normOutlineTitleKey(s.title) === titleKey,
    );
    if (sameTitle.length === 1) {
      startSec = sameTitle[0];
    } else if (sameTitle.length > 1 && storedFrom !== undefined) {
      startSec = sameTitle.reduce((best, s) =>
        Math.abs(s.from - storedFrom) < Math.abs(best.from - storedFrom) ? s : best,
      sameTitle[0]!);
    }
  }

  if (!startSec) return { sectionFrom: -1, sectionTo: -1 };

  const nextPeer = sections.find(
    (s) => s.level > 0 && s.level <= startSec.level && s.from > startSec.from,
  );
  return {
    sectionFrom: startSec.from,
    sectionTo: nextPeer ? nextPeer.from : -1,
  };
}

function docTitle(path: string | null) {
  if (!path) return "Untitled";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "Untitled";
}

function sectionToRef(s: DocSection): SectionRef {
  return {
    id: s.id,
    title: s.title,
    content: s.content,
    from: s.from,
    to: s.to,
  };
}

/**
 * Re-resolve pinned outline sections against live markdown so ids/from/to match after edits.
 * Pass `hintAwareSections` from the editor (bold-only implicit headings) when available so
 * pins match the same boundaries as the sidebar — plain {@see getSectionsFromText} can disagree
 * and yield wrong `content`, wiping subsection structure when the agent applies a replace.
 */
function resolvePinnedSectionsToLiveDoc(
  refs: SectionRef[],
  liveDoc: string,
  hintAwareSections?: DocSection[] | null,
): SectionRef[] {
  if (refs.length === 0) return refs;
  const useHints = Boolean(hintAwareSections?.some((s) => s.level > 0));
  const live = (useHints ? hintAwareSections! : getSectionsFromText(liveDoc)).filter((s) => s.level > 0);
  const byId = new Map(live.map((s) => [s.id, s]));
  return refs.map((ref) => {
    const hit = byId.get(ref.id);
    if (hit) return sectionToRef(hit);
    const prefix = ref.content.trim().slice(0, 48);
    const refTitleKey = normOutlineTitleKey(ref.title);
    const near =
      live.find(
        (s) =>
          normOutlineTitleKey(s.title) === refTitleKey &&
          prefix.length > 0 &&
          s.content.slice(0, Math.min(prefix.length + 24, s.content.length)).includes(prefix),
      ) ??
      live.find((s) => normOutlineTitleKey(s.title) === refTitleKey) ??
      live.find((s) => Math.abs(s.from - ref.from) <= 120 && s.content === ref.content);
    return near ? sectionToRef(near) : ref;
  });
}

function chatSidecarPath(filePath: string | null) {
  if (!filePath) return null;
  return `${filePath}.markapp.chat.json`;
}

function eventTargetInAppDialog(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[role="dialog"]'));
}

export function App() {
  const { colorMode } = useColorMode();
  const isDark = colorMode === "dark";

  const editorRef = useRef<PlateEditorHandle>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [doc, setDoc] = useState(MARKAPP_DEFAULT_STARTER_DOC);
  const [dirty, setDirty] = useState(false);

  const [agentOpen, setAgentOpen] = useState(true);
  const [sectionHoverHighlight, setSectionHoverHighlight] = useState(true);
  const [agentWidth, setAgentWidth] = useState(380);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateMgrOpen, setTemplateMgrOpen] = useState(false);
  const [quickAIOpen, setQuickAIOpen] = useState(false);
  const [quickSectionTitle, setQuickSectionTitle] = useState("");

  const [previewMode, setPreviewMode] = useState(false);
  const [zenMode, setZenMode] = useState(false);

  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const [activeSectionFrom, setActiveSectionFrom] = useState<number | null>(null);
  /** Timestamp of last explicit outline-pick; syncCursor is suppressed for 800ms after a pick. */
  const lastOutlinePickRef = useRef<number>(0);

  const paletteActionsRef = useRef<{
    save: () => Promise<void>;
    saveAs: () => Promise<void>;
    openDoc: () => Promise<void>;
    newDoc: () => void;
    copyWholeDoc: () => Promise<void>;
    runAutoSection: () => void;
    setAgentOpen: Dispatch<SetStateAction<boolean>>;
    setPaletteOpen: Dispatch<SetStateAction<boolean>>;
    setQuickAIOpen: Dispatch<SetStateAction<boolean>>;
    setQuickSectionTitle: Dispatch<SetStateAction<string>>;
  }>(null!);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [contextSections, setContextSections] = useState<SectionRef[]>([]);
  const [mentionDocument, setMentionDocument] = useState(false);
  const [mentionClipboard, setMentionClipboard] = useState(false);
  /**
   * Green gutter after the latest successful AI apply. `contentHash` is {@link hashMarkdownSlice} of
   * `doc.slice(from, to)` at apply time — manual edits inside that span clear the gutter when the hash diverges.
   */
  const [lastAssistantChangeRange, setLastAssistantChangeRange] = useState<{
    from: number;
    to: number;
    contentHash: string;
  } | null>(null);

  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [showWelcome, setShowWelcome] = useState(true);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [resizerHover, setResizerHover] = useState(false);
  const [outlineWidth, setOutlineWidth] = useState(240);
  const [outlineResizerHover, setOutlineResizerHover] = useState(false);
  const [aiPdfExportBusy, setAiPdfExportBusy] = useState(false);
  const [aiPdfDlgOpen, setAiPdfDlgOpen] = useState(false);
  const [aiPdfProgress, setAiPdfProgress] = useState(0);
  const [aiPdfStatus, setAiPdfStatus] = useState("");
  const [aiPdfError, setAiPdfError] = useState<string | null>(null);

  const chatHistoryRef = useRef<MessageParam[]>([]);

  useEffect(() => {
    if (!lastAssistantChangeRange) return;
    const { from, to, contentHash } = lastAssistantChangeRange;
    if (!contentHash || to <= from) {
      setLastAssistantChangeRange(null);
      return;
    }
    const end = Math.min(to, doc.length);
    if (end <= from) {
      setLastAssistantChangeRange(null);
      return;
    }
    if (hashMarkdownSlice(doc, { from, to: end }) !== contentHash) {
      setLastAssistantChangeRange(null);
    }
  }, [doc, lastAssistantChangeRange]);

  useEffect(() => {
    setOutlineFromEditor(null);
  }, [editorKey]);

  const refreshRecents = useCallback(async () => {
    const r = (await window.markAPI?.getStore("recentFiles")) as string[] | undefined;
    setRecentFiles(r ?? []);
  }, []);

  useEffect(() => {
    void refreshRecents();
  }, [refreshRecents]);

  const [outlineFromEditor, setOutlineFromEditor] = useState<DocSection[] | null>(null);

  useEffect(() => {
    if (!sectionHoverHighlight) {
      setOutlineFromEditor(null);
      return;
    }
    if (showWelcome || previewMode) return;
    queueMicrotask(() => {
      editorRef.current?.syncOutlineSections();
    });
  }, [sectionHoverHighlight, showWelcome, previewMode]);

  const sections = outlineFromEditor ?? getSectionsFromText(doc);
  const outline = useMemo(() => buildOutline(sections.filter((s) => s.level > 0)), [sections]);
  const allSectionRefs = useMemo(() => sections.filter((s) => s.level > 0).map(sectionToRef), [sections]);
  const outlineActiveSectionId = useMemo(
    () =>
      activeSectionFrom != null
        ? (findDocSectionForOutlineMarkdownFrom(sections, activeSectionFrom)?.id ?? null)
        : null,
    [sections, activeSectionFrom],
  );

  const onOutlinePick = useCallback((node: OutlineNode) => {
    lastOutlinePickRef.current = Date.now();
    editorRef.current?.flushMarkdownToParent();
    setActiveSectionFrom(node.from);
    editorRef.current?.focusSectionAtMarkdownFrom(node.from);
  }, []);

  /** Editor content after flushing any debounced sync (use before save, agent, copy). */
  const getLiveMarkdown = useCallback((): string => {
    if (previewMode || showWelcome || !editorRef.current) return doc;
    editorRef.current.flushMarkdownToParent();
    return editorRef.current.getMarkdown();
  }, [previewMode, showWelcome, doc]);

  const exportAiPdfFromTitleBar = useCallback(() => {
    if (!window.markAPI) return;
    if (showWelcome || previewMode || !editorRef.current) {
      toaster.create({
        type: "warning",
        title: "No document",
        description: "Open the editor and add content before exporting to PDF.",
      });
      return;
    }
    editorRef.current.flushMarkdownToParent();
    const md = editorRef.current.getMarkdown();
    if (!md.trim()) {
      toaster.create({
        type: "warning",
        title: "Empty document",
        description: "Add some content before exporting to PDF.",
      });
      return;
    }
    const defaultPdf =
      filePath && /\.(md|markdown|txt)$/i.test(filePath)
        ? filePath.replace(/\.(md|markdown|txt)$/i, ".pdf")
        : filePath
          ? `${filePath}.pdf`
          : undefined;
    setAiPdfError(null);
    setAiPdfProgress(0);
    setAiPdfStatus("Preparing document…");
    setAiPdfDlgOpen(true);
    setAiPdfExportBusy(true);
    void (async () => {
      try {
        const written = await exportCurrentDocToAiPdf(md, defaultPdf ?? undefined, (p) => {
          setAiPdfProgress(p.progress);
          setAiPdfStatus(p.status);
        });
        if (written) {
          toaster.create({
            type: "success",
            title: "PDF saved",
            description: "AI layout export finished.",
          });
          setAiPdfDlgOpen(false);
          setAiPdfStatus("");
          setAiPdfProgress(0);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setAiPdfError(msg);
        toaster.create({
          type: "error",
          title: "PDF export failed",
          description: msg,
        });
      } finally {
        setAiPdfExportBusy(false);
      }
    })();
  }, [showWelcome, previewMode, filePath]);

  /** Inline AI diff UI on the sheet (highlight + Keep / Undo), same proposal as the agent chat. */
  const editorProposalInline = useMemo(() => {
    const documentIsBlank = isEffectivelyBlankDocument(doc);

    // Show streaming overlay only when we know a sectionProposal will be created:
    // exactly one pinned section, or the document is blank. The "wholeDocNoPins" case
    // (no pins, non-blank doc) is excluded here because we can't know until streaming ends
    // whether the output will qualify as a document draft — showing the overlay for every
    // ordinary chat reply would be a false positive.
    if (agentBusy && streamingText && (contextSections.length === 1 || documentIsBlank)) {
      const ref = contextSections.length === 1 ? contextSections[0]! : null;
      const title = documentIsBlank ? "Document" : ref!.title;
      let sectionFrom = -1;
      let sectionTo = -1;
      let oldText = "";
      if (documentIsBlank) {
        sectionFrom = -1;
        sectionTo = -1;
        oldText = "";
      } else if (ref) {
        oldText = ref.content;
        sectionFrom = ref.from;
        sectionTo = ref.to;
        if (title === "(Selection)" && sectionTo <= sectionFrom && ref.content) {
          const i = doc.indexOf(ref.content);
          if (i >= 0) {
            sectionFrom = i;
            sectionTo = i + ref.content.length;
          }
        }
      }
      return {
        state: "streaming" as const,
        sectionTitle: title,
        sectionFrom,
        sectionTo,
        oldText,
        newText: streamingText,
      };
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.sectionProposal && m.sectionProposal.accepted === undefined) {
        const p = m.sectionProposal;
        const title = p.sectionTitle ?? "Section";
        return {
          state: "pending" as const,
          sectionTitle: title,
          messageId: m.id,
          oldText: p.oldText,
          newText: p.newText,
          ...resolveProposalMarkdownRange(p, sections, doc),
        };
      }
    }
    return null;
  }, [agentBusy, streamingText, doc, contextSections, messages, sections]);

  const wordCount = useMemo(() => doc.trim().split(/\s+/).filter(Boolean).length, [doc]);
  const sectionCount = useMemo(() => sections.filter((s) => s.level > 0).length, [sections]);

  useEffect(() => {
    window.markAPI?.setDirty(dirty);
  }, [dirty]);

  const syncCursor = useCallback(() => {
    // Don't let the polling interval override an explicit outline click for a short window.
    if (Date.now() - lastOutlinePickRef.current < 800) return;
    const ed = editorRef.current?.getEditor();
    if (!ed || !ReactEditor.isFocused(ed as any)) return;
    const cur = editorRef.current?.getCursorMarkdownSection();
    // Only update when the caret is in a known section — don't clear the selected highlight
    // when focus moves away or the caret lands in the preamble.
    if (cur) {
      setActiveHeading(cur.title);
      setActiveSectionFrom(cur.from);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => syncCursor(), 400);
    return () => window.clearInterval(id);
  }, [syncCursor]);

  const saveChat = useCallback(async () => {
    const p = chatSidecarPath(filePath);
    if (!p) return;
    const payload = JSON.stringify(
      {
        messages,
        apiHistory: chatHistoryRef.current,
        contextSections,
        mentionDocument,
        mentionClipboard,
      },
      null,
      2,
    );
    await window.markAPI?.writeFile(p, payload);
  }, [filePath, messages, contextSections, mentionDocument, mentionClipboard]);

  const loadChat = useCallback(async (path: string | null) => {
    const p = chatSidecarPath(path);
    if (!p) {
      setMessages([]);
      setContextSections([]);
      setMentionDocument(false);
      setMentionClipboard(false);
      chatHistoryRef.current = [];
      return;
    }
    const r = (await window.markAPI?.readFile(p)) ?? { ok: false as const, error: "no markAPI" };
    if (!r.ok) {
      setMessages([]);
      setContextSections([]);
      setMentionDocument(false);
      setMentionClipboard(false);
      chatHistoryRef.current = [];
      return;
    }
    try {
      const data = JSON.parse(r.content) as {
        messages?: ChatMessage[];
        apiHistory?: MessageParam[];
        contextSections?: SectionRef[];
        mentionDocument?: boolean;
        mentionClipboard?: boolean;
      };
      setMessages(data.messages ?? []);
      setContextSections(data.contextSections ?? []);
      setMentionDocument(!!data.mentionDocument);
      setMentionClipboard(!!data.mentionClipboard);
      chatHistoryRef.current = (data.apiHistory ??
        (data.messages ?? []).map((m) => ({ role: m.role, content: m.content }))) as MessageParam[];
    } catch {
      setMessages([]);
      setContextSections([]);
      setMentionDocument(false);
      setMentionClipboard(false);
      chatHistoryRef.current = [];
    }
  }, []);

  useEffect(() => {
    void saveChat().catch((e) => {
      console.error(e);
      toaster.create({
        type: "error",
        title: "Could not save chat",
        description: e instanceof Error ? e.message : String(e),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist when chat state changes
  }, [messages, contextSections, mentionDocument, mentionClipboard, filePath]);

  const persistDoc = useCallback(async () => {
    if (!filePath) return;
    const md = getLiveMarkdown();
    await writeTextFile(filePath, md);
    setDirty(false);
  }, [filePath, getLiveMarkdown]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    void (async () => {
      const ms = (await window.markAPI?.getStore("autoSaveMs")) as number | undefined;
      const delay = typeof ms === "number" && ms > 0 ? ms : 0;
      if (cancelled || delay <= 0) return;
      intervalId = setInterval(() => {
        if (filePath && dirty) {
          void persistDoc().catch((e) =>
            toaster.create({
              type: "error",
              title: "Auto-save failed",
              description: (e as Error).message,
            }),
          );
        }
      }, delay);
    })();
    return () => {
      cancelled = true;
      if (intervalId != null) clearInterval(intervalId);
    };
  }, [filePath, dirty, persistDoc]);

  const newDoc = () => {
    setShowWelcome(false);
    setFilePath(null);
    setDoc("# \n");
    setDirty(false);
    setEditorKey((k) => k + 1);
    setContextSections([]);
    setMentionDocument(false);
    setMentionClipboard(false);
    setLastAssistantChangeRange(null);
    void loadChat(null);
  };

  const loadPathIntoEditor = async (p: string) => {
    try {
      let text = await readTextFile(p);
      const initialSecs = getSectionsFromText(text);
      const onlyRoot = initialSecs.length === 1 && initialSecs[0]?.level === 0;
      const skipAutoSectionBecauseManual = hasManualSectionMarkersInMarkdown(text);
      if (onlyRoot && !skipAutoSectionBecauseManual && text.trim().length >= 400) {
        try {
          setAgentBusy(true);
          text = await autoSectionDocument(text);
        } catch {
          toaster.create({
            type: "info",
            title: "Opened without AI structure",
            description: "Could not auto-add sections — open Settings to set your API key, or edit headings manually.",
          });
        } finally {
          setAgentBusy(false);
        }
      }
      setFilePath(p);
      setDoc(text);
      setDirty(false);
      setEditorKey((k) => k + 1);
      await pushRecent(p);
      await refreshRecents();
      void loadChat(p);
      setShowWelcome(false);
      setLastAssistantChangeRange(null);
      toaster.create({
        type: "success",
        title: "Opened",
        description: docTitle(p),
      });
    } catch (e) {
      toaster.create({
        type: "error",
        title: "Could not open file",
        description: (e as Error).message,
      });
    }
  };

  const openDoc = async () => {
    const p = await openFileDialog();
    if (!p) return;
    await loadPathIntoEditor(p);
  };

  const save = async () => {
    if (filePath) {
      try {
        await persistDoc();
        toaster.create({ type: "success", title: "Saved", description: docTitle(filePath) });
      } catch (e) {
        toaster.create({
          type: "error",
          title: "Save failed",
          description: (e as Error).message,
        });
      }
      return;
    }
    const p = await saveFileDialog();
    if (!p) return;
    setFilePath(p);
    try {
      await writeTextFile(p, getLiveMarkdown());
      setDirty(false);
      await pushRecent(p);
      await refreshRecents();
      void loadChat(p);
      toaster.create({ type: "success", title: "Saved", description: docTitle(p) });
    } catch (e: unknown) {
      toaster.create({
        type: "error",
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const saveAs = async () => {
    const p = await saveFileDialog(filePath ?? undefined);
    if (!p) return;
    setFilePath(p);
    try {
      await writeTextFile(p, getLiveMarkdown());
      setDirty(false);
      await pushRecent(p);
      await refreshRecents();
      void loadChat(p);
      toaster.create({ type: "success", title: "Saved", description: docTitle(p) });
    } catch (e) {
      toaster.create({
        type: "error",
        title: "Save failed",
        description: (e as Error).message,
      });
    }
  };

  const saveBeforeWindowClose = useCallback(async (): Promise<boolean> => {
    try {
      if (filePath) {
        const md = getLiveMarkdown();
        await writeTextFile(filePath, md);
        setDirty(false);
        return true;
      }
      const p = await saveFileDialog();
      if (!p) return false;
      await writeTextFile(p, getLiveMarkdown());
      setFilePath(p);
      setDirty(false);
      await pushRecent(p);
      await refreshRecents();
      void loadChat(p);
      return true;
    } catch (e) {
      toaster.create({
        type: "error",
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  }, [filePath, getLiveMarkdown, loadChat, refreshRecents]);

  const saveBeforeCloseRef = useRef(saveBeforeWindowClose);
  saveBeforeCloseRef.current = saveBeforeWindowClose;

  useEffect(() => {
    const api = window.markAPI;
    if (!api?.subscribeSaveBeforeClose) return;
    return api.subscribeSaveBeforeClose(async () => saveBeforeCloseRef.current());
  }, []);

  const clearChat = () => {
    setMessages([]);
    chatHistoryRef.current = [];
    setStreamingText("");
  };

  const onMarkdownChange = useCallback((md: string) => {
    startTransition(() => setDoc(md));
    setDirty(true);
  }, []);

  const applySectionReplacementToEditor = useCallback(
    (
      oldText: string,
      newText: string,
      opts?: {
        normalizeReplacement?: boolean;
        replaceHintIndex?: number;
        /** When set (e.g. pinned section), replace this half-open span if it matches `oldText` — avoids wrong first-match when the same text appears earlier in the doc. */
        replaceRange?: { from: number; to: number };
      },
    ): boolean => {
      const normalizeReplacement = opts?.normalizeReplacement !== false;
      const replacement = normalizeReplacement ? sanitizeAssistantMarkdownOutput(newText) : newText;
      const handle = editorRef.current;
      if (!handle) return false;
      const current = handle.getMarkdown();
      let nextMd: string;
      if (isEffectivelyBlankDocument(current) || oldText === "") {
        // Blank or placeholder document — insert the whole response directly
        nextMd = replacement;
      } else {
        const rr = opts?.replaceRange;
        if (rr !== undefined && rr.from >= 0 && rr.to > rr.from) {
          const to = Math.min(rr.to, current.length);
          const from = Math.min(rr.from, to);
          if (from < to) {
            const slice = current.slice(from, to);
            if (markdownSlicesMatchForReplace(slice, oldText)) {
              nextMd = current.slice(0, from) + replacement + current.slice(to);
              handle.setMarkdown(nextMd);
              setDoc(handle.getMarkdown());
              setDirty(true);
              return true;
            }
          }
        }

        const hint = opts?.replaceHintIndex;
        const hinted =
          hint !== undefined && hint >= 0 ? replaceSubstringAtHint(current, oldText, replacement, hint) : null;
        const replaced =
          hinted !== null && hinted !== current
            ? hinted
            : (() => {
                const r = current.replace(oldText, replacement);
                return r !== current ? r : null;
              })();
        if (replaced !== null) {
          nextMd = replaced;
        } else if (oldText.length > current.length * 0.6) {
          // oldText was most of the document, so a whole-doc replacement was intended
          nextMd = replacement;
        } else {
          // Section text not found in the current document (stale snapshot, user edited
          // while streaming, etc.) — do nothing rather than silently overwrite.
          return false;
        }
      }
      handle.setMarkdown(nextMd);
      setDoc(handle.getMarkdown());
      setDirty(true);
      return true;
    },
    [],
  );

  const acceptProposal = useCallback((msgId: string) => {
    setMessages((prev) => {
      const cur = prev.find((m) => m.id === msgId);
      const af = cur?.sectionProposal?.appliedMarkdownFrom;
      const at = cur?.sectionProposal?.appliedMarkdownTo;
      const storedHash = cur?.sectionProposal?.appliedContentHash;
      if (af != null && at != null && at >= af) {
        queueMicrotask(() => {
          editorRef.current?.flushMarkdownToParent();
          const live = editorRef.current?.getMarkdown() ?? "";
          const end = Math.min(at, live.length);
          const contentHash =
            storedHash && end > af ? storedHash : hashMarkdownSlice(live, { from: af, to: end });
          setLastAssistantChangeRange({ from: af, to: at, contentHash });
        });
      }
      return prev.map((m) =>
        m.id === msgId && m.sectionProposal
          ? { ...m, sectionProposal: { ...m.sectionProposal, accepted: true } }
          : m,
      );
    });
  }, []);

  const revertProposal = useCallback((msgId: string) => {
    const handle = editorRef.current;
    if (!handle) return;
    handle.flushMarkdownToParent();
    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.sectionProposal) return;
    const { oldText, newText } = msg.sectionProposal;
    const p = msg.sectionProposal;
    const live = handle.getMarkdown();
    const normalizedNew = normalizeAssistantMarkdownParagraphs(newText);
    const needles = [...new Set([normalizedNew, newText].filter((s) => s.length > 0))];
    const hint = msg.sectionProposal.sectionMarkdownFrom;

    let nextMd: string | null = null;

    if (
      p.appliedMarkdownFrom !== undefined &&
      p.appliedMarkdownTo !== undefined &&
      p.appliedMarkdownFrom >= 0 &&
      p.appliedMarkdownTo >= p.appliedMarkdownFrom
    ) {
      const end = Math.min(p.appliedMarkdownTo, live.length);
      if (end >= p.appliedMarkdownFrom) {
        const sliceHash = hashMarkdownSlice(live, { from: p.appliedMarkdownFrom, to: end });
        if (!p.appliedContentHash || sliceHash === p.appliedContentHash) {
          nextMd = live.slice(0, p.appliedMarkdownFrom) + oldText + live.slice(end);
        }
      }
    }

    if (nextMd == null) {
      for (const needle of needles) {
        const replaced = replaceSubstringAtHint(live, needle, oldText, hint);
        if (replaced !== null && replaced !== live) {
          nextMd = replaced;
          break;
        }
      }
    }

    if (nextMd == null && oldText === "") {
      for (const needle of needles) {
        if (live === needle || live.trim() === needle.trim()) {
          nextMd = "";
          break;
        }
      }
    }

    const normLive = normalizeAssistantMarkdownParagraphs(live);
    if (nextMd == null) {
      for (const needle of needles) {
        if (needle && normLive === normalizeAssistantMarkdownParagraphs(needle)) {
          nextMd = oldText;
          break;
        }
      }
    }

    // Apply used whole-document swap when `oldText` was most of the doc — serialized markdown may
    // not contain the stored `newText` as a literal substring after Plate round-trips.
    if (nextMd == null && oldText.length > 0 && oldText.length > live.length * 0.6) {
      nextMd = oldText;
    }

    if (nextMd == null && msg.sectionProposal.sectionTitle === "Document" && oldText.length > 0) {
      nextMd = oldText;
    }

    // Plate serialize/round-trip often changes markdown so `newText` is no longer a literal substring of
    // `live`. The overlay already resolves the edited span via outline — reuse that for revert.
    if (nextMd == null) {
      const title = msg.sectionProposal.sectionTitle ?? "Section";
      if (title !== "Document") {
        const liveSections = handle.getOutlineDocSections();
        const resolved = resolveProposalMarkdownRange(msg.sectionProposal, liveSections, live);
        const { sectionFrom, sectionTo } = resolved;
        if (sectionFrom >= 0) {
          const end = sectionTo < 0 ? live.length : sectionTo;
          if (end >= sectionFrom) {
            nextMd = live.slice(0, sectionFrom) + oldText + live.slice(end);
          }
        }
      }
    }

    if (nextMd == null) return;

    handle.setMarkdown(nextMd);
    setDoc(handle.getMarkdown());
    setDirty(true);
    setLastAssistantChangeRange(null);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.sectionProposal
          ? { ...m, sectionProposal: { ...m.sectionProposal, accepted: false } }
          : m,
      ),
    );
  }, [messages]);

  const addSectionToChat = useCallback((node: OutlineNode) => {
    const sec = sections.find((s) => s.id === node.id || s.from === node.from);
    if (!sec) return;
    const ref = sectionToRef(sec);
    setContextSections((prev) => (prev.some((p) => p.id === ref.id) ? prev : [...prev, ref]));
  }, [sections]);

  const addSectionRefToAgent = useCallback((ref: SectionRef) => {
    setContextSections((prev) => (prev.some((p) => p.id === ref.id) ? prev : [...prev, ref]));
  }, []);

  const sendAgentMessage = async (text: string) => {
    const pendingProposal = messages.some(
      (m) => m.sectionProposal && m.sectionProposal.accepted === undefined,
    );
    if (pendingProposal) {
      toaster.create({
        type: "warning",
        title: "Pending AI edit",
        description: "Keep or revert the highlighted change before sending another message.",
      });
      return;
    }

    if (!previewMode && !showWelcome && editorRef.current) {
      editorRef.current.flushMarkdownToParent();
    }
    const liveDoc =
      !previewMode && !showWelcome && editorRef.current
        ? editorRef.current.getMarkdown()
        : doc;
    const editorHintOutline =
      !previewMode && !showWelcome && editorRef.current
        ? editorRef.current.getOutlineDocSections()
        : null;
    const sectionsForAgent =
      !previewMode && !showWelcome && editorRef.current
        ? editorHintOutline?.some((s) => s.level > 0)
          ? editorHintOutline
          : getSectionsFromText(liveDoc)
        : sections;
    const sectionsForOutline =
      previewMode || showWelcome || !editorRef.current
        ? getSectionsFromText(liveDoc)
        : (outlineFromEditor ?? getSectionsFromText(liveDoc));

    let clip: string | null = null;
    if (mentionClipboard) {
      try {
        const snap = await readClipboardSnapshotAsync();
        const kind = classifyClipboardRichness(snap);
        if (kind === "oversized" || kind === "plain" || !snap.html?.trim()) {
          clip = snap.plain.trim() ? snap.plain : htmlToPlainText(snap.html ?? "");
        } else {
          const conv = htmlToGfmMarkdown(snap.html ?? "", snap.plain);
          clip = conv.ok
            ? conv.markdown
            : snap.plain.trim()
              ? snap.plain
              : htmlToPlainText(snap.html ?? "");
        }
        if (!clip?.trim()) clip = "(clipboard empty)";
      } catch {
        clip = "(clipboard unavailable)";
      }
    }

    // Auto-grep: when no explicit context sections are set and the doc has content,
    // silently find relevant sections to include as background context.
    const hasExplicitContext =
      contextSections.length > 0 || mentionDocument || mentionClipboard;
    const autoGrepSections =
      !hasExplicitContext && liveDoc.trim()
        ? findRelevantSections(text, sectionsForAgent, 3)
        : [];

    const contextualPins =
      contextSections.length > 0
        ? resolvePinnedSectionsToLiveDoc(contextSections, liveDoc, editorHintOutline)
        : [];
    const hadAutoGrepBackground =
      !hasExplicitContext && Boolean(liveDoc.trim()) && autoGrepSections.length > 0;

    const effectiveSections = hasExplicitContext
      ? contextualPins.length > 0
        ? contextualPins
        : contextSections
      : autoGrepSections.map((s) => ({
          id: s.id,
          title: s.title,
          content: s.content,
          from: s.from,
          to: s.to,
        }));

    const blankish = isEffectivelyBlankDocument(liveDoc);
    const directEditorOutput = contextualPins.length === 1 || blankish;

    const userContent = buildTieredAgentUserPayload({
      instruction: text,
      fullDocument: liveDoc,
      sections: effectiveSections,
      documentSections: sectionsForOutline,
      mentionDocument,
      mentionClipboard: mentionClipboard ? clip : null,
      directEditorOutput,
    });

    const priorDraft = lastAssistantDraft(messages);
    if (wantsApplyPriorReplyToDoc(text) && priorDraft && isEffectivelyBlankDocument(liveDoc)) {
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text };
      setMessages((m) => [...m, userMsg]);
      chatHistoryRef.current.push({ role: "user", content: userContent });
      const appliedPrior = applySectionReplacementToEditor("", priorDraft);
      if (!appliedPrior) {
        toaster.create({
          type: "info",
          title: "Could not apply previous reply",
          description: "The editor was not ready. Try again from the editor.",
        });
      }
      const ack =
        "Done — I added my previous reply to your document. You can still edit or undo in the editor.";
      const asst: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: ack,
      };
      setMessages((m) => [...m, asst]);
      chatHistoryRef.current.push({ role: "assistant", content: ack });
      return;
    }

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    chatHistoryRef.current.push({ role: "user", content: userContent });

    setAgentBusy(true);
    setStreamingText("");
    try {
      const systemSuffix = await loadAgentSystemSuffix();
      const disallowCodeBlocks = Boolean(await window.markAPI?.getStore("agentDisallowCodeBlocks"));
      const streamOpts: { systemSuffix?: string; disallowCodeBlocks?: boolean } = {};
      if (systemSuffix) streamOpts.systemSuffix = systemSuffix;
      if (disallowCodeBlocks) streamOpts.disallowCodeBlocks = true;
      let full = "";
      await streamAgentTurn(
        [...chatHistoryRef.current],
        (chunk) => {
          full += chunk;
          setStreamingText(full);
        },
        Object.keys(streamOpts).length > 0 ? streamOpts : undefined,
      );

      const cleaned = sanitizeAssistantMarkdownOutput(stripOuterMarkdownCodeFence(full));
      const baselineMarkdown = liveDoc;
      const wholeDocUnpinned =
        contextualPins.length === 0 &&
        !hadAutoGrepBackground &&
        !blankish &&
        looksLikeAssistantDocumentDraft(cleaned);
      const sectionProposal =
        cleaned && (contextualPins.length === 1 || blankish || wholeDocUnpinned)
          ? {
              oldText:
                blankish ? "" : contextualPins.length === 1 ? contextualPins[0].content : baselineMarkdown,
              newText: cleaned,
              sectionTitle:
                blankish ? "Document" : contextualPins.length === 1 ? contextualPins[0].title : "Document",
              targetSectionId: contextualPins.length === 1 ? contextualPins[0].id : undefined,
              sectionMarkdownFrom:
                contextualPins.length === 1 ? contextualPins[0].from : undefined,
              sectionMarkdownTo:
                contextualPins.length === 1 ? contextualPins[0].to : undefined,
            }
          : undefined;

      const asstId = `a-${Date.now()}`;
      const asst: ChatMessage = {
        id: asstId,
        role: "assistant",
        content: cleaned,
        sectionProposal,
      };
      setMessages((m) => [...m, asst]);
      chatHistoryRef.current.push({ role: "assistant", content: cleaned });
      setStreamingText("");

      if (sectionProposal) {
        const beforeApply =
          !previewMode && !showWelcome && editorRef.current
            ? editorRef.current.getMarkdown()
            : liveDoc;
        const applied = applySectionReplacementToEditor(sectionProposal.oldText, sectionProposal.newText, {
          replaceHintIndex: sectionProposal.sectionMarkdownFrom,
          replaceRange:
            sectionProposal.sectionMarkdownFrom != null &&
            sectionProposal.sectionMarkdownTo != null &&
            sectionProposal.sectionMarkdownTo > sectionProposal.sectionMarkdownFrom
              ? { from: sectionProposal.sectionMarkdownFrom, to: sectionProposal.sectionMarkdownTo }
              : undefined,
        });
        if (!applied) {
          toaster.create({
            type: "info",
            title: "Could not apply edit",
            description: "The document may have changed so the section no longer matches.",
          });
        } else if (!previewMode && !showWelcome && editorRef.current) {
          editorRef.current.flushMarkdownToParent();
          const after = editorRef.current.getMarkdown();
          const span = findReplacedMarkdownSpan(beforeApply, after);
          const appliedPatch =
            span != null
              ? {
                  appliedMarkdownFrom: span.from,
                  appliedMarkdownTo: span.to,
                  appliedContentHash: hashMarkdownSlice(after, span),
                }
              : {};
          if (Object.keys(appliedPatch).length > 0) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === asstId && msg.sectionProposal
                  ? { ...msg, sectionProposal: { ...msg.sectionProposal, ...appliedPatch } }
                  : msg,
              ),
            );
          }
          if (span) {
            setLastAssistantChangeRange({
              ...span,
              contentHash: hashMarkdownSlice(after, span),
            });
            queueMicrotask(() => {
              editorRef.current?.scrollMarkdownRangeIntoView(span.from, span.to);
            });
          }
        }
        summarizeSectionChanges(
          sectionProposal.oldText,
          sectionProposal.newText,
          sectionProposal.sectionTitle ?? "Section",
        ).then((summary) => {
          if (!summary.length) return;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === asstId && msg.sectionProposal
                ? { ...msg, sectionProposal: { ...msg.sectionProposal, summary } }
                : msg,
            ),
          );
        });
      }
    } catch (e) {
      toaster.create({
        type: "error",
        title: "Claude error",
        description: (e as Error).message,
      });
    } finally {
      setAgentBusy(false);
      setStreamingText("");
    }
  };

  const quickAIRun = async (instruction: string) => {
    if (!previewMode && !showWelcome && editorRef.current) {
      editorRef.current.flushMarkdownToParent();
    }
    const liveDoc =
      !previewMode && !showWelcome && editorRef.current
        ? editorRef.current.getMarkdown()
        : doc;
    const hintOutline = editorRef.current?.getOutlineDocSections() ?? null;
    const sectionsLive = (hintOutline?.some((s) => s.level > 0) ? hintOutline : getSectionsFromText(liveDoc)).filter(
      (s) => s.level > 0,
    );
    const cur = editorRef.current?.getCursorMarkdownSection();
    const sec = cur
      ? sectionsLive.find((s) => s.from === cur.from) ??
        sectionsLive.find((s) => cur.from >= s.from && cur.from < s.to)
      : sectionsLive[0] ?? null;
    if (!sec) return;
    setAgentBusy(true);
    try {
      let out = "";
      await streamSectionReplace(sec.content, instruction, (c) => {
        out += c;
      });
      const cleaned = sanitizeAssistantMarkdownOutput(stripOuterMarkdownCodeFence(out.trim()));
      const beforeApply = liveDoc;
      const appliedQuick = applySectionReplacementToEditor(sec.content, cleaned, {
        replaceHintIndex: sec.from,
        replaceRange: { from: sec.from, to: sec.to },
      });
      if (!appliedQuick) {
        toaster.create({
          type: "info",
          title: "Could not apply edit",
          description: "The document may have changed so this section no longer matches.",
        });
      } else if (editorRef.current) {
        editorRef.current.flushMarkdownToParent();
        const after = editorRef.current.getMarkdown();
        const span = findReplacedMarkdownSpan(beforeApply, after);
        if (span) {
          setLastAssistantChangeRange({
            ...span,
            contentHash: hashMarkdownSlice(after, span),
          });
          queueMicrotask(() => {
            editorRef.current?.scrollMarkdownRangeIntoView(span.from, span.to);
          });
        }
      }
    } catch (e) {
      toaster.create({
        type: "error",
        title: "Quick AI failed",
        description: (e as Error).message,
      });
    } finally {
      setAgentBusy(false);
    }
  };

  const copyWholeDoc = async () => {
    try {
      await navigator.clipboard.writeText(getLiveMarkdown());
      toaster.create({ type: "success", title: "Copied", description: "Entire document copied to clipboard." });
    } catch (e) {
      toaster.create({
        type: "error",
        title: "Copy failed",
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const runAutoSectionCommand = useCallback(() => {
    void (async () => {
      const md = getLiveMarkdown();
      const secs = getSectionsFromText(md);
      const onlyRoot = secs.length === 1 && secs[0]?.level === 0;
      const hasManualBreaks = hasManualSectionMarkersInMarkdown(md);
      if (hasManualBreaks) {
        toaster.create({
          type: "info",
          title: "Manual section breaks present",
          description:
            "AI auto-section is disabled while <!--markapp-manual-section--> lines exist so they are not removed.",
        });
        return;
      }
      if (!onlyRoot) {
        toaster.create({
          type: "info",
          title: "Already structured",
          description: "Document already has section headings.",
        });
        return;
      }
      setAgentBusy(true);
      try {
        const next = await autoSectionDocument(md);
        editorRef.current?.setMarkdown(next);
        setDoc(next);
        setDirty(true);
        toaster.create({ type: "success", title: "Sections added" });
      } catch (e) {
        toaster.create({
          type: "error",
          title: "Auto-section failed",
          description: (e as Error).message,
        });
      } finally {
        setAgentBusy(false);
      }
    })();
  }, [getLiveMarkdown]);

  const saveAsTemplate = async (name: string) => {
    const api = window.markAPI;
    if (!api) return;
    const dir = await api.userTemplatesDir();
    const base = name.trim().replace(/\.md$/i, "") || "my_template";
    const safe = base.replace(/[^a-zA-Z0-9-_]+/g, "_");
    const path = `${dir}\\${safe}.md`;
    const r = await api.saveTemplateFile(path, getLiveMarkdown());
    if (!r.ok) {
      toaster.create({ type: "error", title: "Save failed", description: r.error });
    } else {
      toaster.create({ type: "success", title: "Template saved", description: `Saved as "${safe}.md"` });
    }
  };

  paletteActionsRef.current = {
    save,
    saveAs,
    openDoc,
    newDoc,
    copyWholeDoc,
    runAutoSection: runAutoSectionCommand,
    setAgentOpen,
    setPaletteOpen,
    setQuickAIOpen,
    setQuickSectionTitle,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inDialog = eventTargetInAppDialog(e.target);
      const allowFileAndCopy = !inDialog;

      if (mod && e.key.toLowerCase() === "s" && !e.shiftKey) {
        if (!allowFileAndCopy) return;
        e.preventDefault();
        void paletteActionsRef.current.save();
      }
      if (mod && e.key.toLowerCase() === "o" && !e.shiftKey) {
        if (!allowFileAndCopy) return;
        e.preventDefault();
        void paletteActionsRef.current.openDoc();
      }
      if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) {
        if (!allowFileAndCopy) return;
        e.preventDefault();
        paletteActionsRef.current.newDoc();
      }
      if (mod && e.key.toLowerCase() === "s" && e.shiftKey) {
        if (!allowFileAndCopy) return;
        e.preventDefault();
        void paletteActionsRef.current.saveAs();
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
        if (!allowFileAndCopy) return;
        e.preventDefault();
        void paletteActionsRef.current.copyWholeDoc();
      }
      if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        paletteActionsRef.current.setAgentOpen((o) => !o);
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const cur = editorRef.current?.getCursorMarkdownSection();
        paletteActionsRef.current.setQuickSectionTitle(cur?.title ?? "(no section)");
        paletteActionsRef.current.setQuickAIOpen(true);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        paletteActionsRef.current.setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: "new",
        label: "New document",
        category: "File",
        keywords: ["clear", "blank"],
        shortcut: modShortcut("N"),
        icon: <FilePlus size={14} />,
        run: () => paletteActionsRef.current.newDoc(),
      },
      {
        id: "open",
        label: "Open…",
        category: "File",
        shortcut: modShortcut("O"),
        icon: <FolderOpen size={14} />,
        run: () => void paletteActionsRef.current.openDoc(),
      },
      {
        id: "save",
        label: "Save",
        category: "File",
        shortcut: modShortcut("S"),
        icon: <Save size={14} />,
        run: () => void paletteActionsRef.current.save(),
      },
      {
        id: "saveas",
        label: "Save as…",
        category: "File",
        shortcut: modShiftShortcut("S"),
        icon: <SaveAll size={14} />,
        run: () => void paletteActionsRef.current.saveAs(),
      },
      {
        id: "template",
        label: "New from template",
        category: "File",
        icon: <Sparkles size={14} />,
        run: () => {
          setShowWelcome(false);
          setTemplatePickerOpen(true);
        },
      },
      {
        id: "tpl-mgr",
        label: "Template manager",
        category: "File",
        icon: <LayoutTemplate size={14} />,
        run: () => setTemplateMgrOpen(true),
      },
      {
        id: "copy-doc",
        label: "Copy entire document",
        category: "Edit",
        shortcut: modShiftShortcut("C"),
        icon: <Copy size={14} />,
        run: () => void copyWholeDoc(),
      },
      {
        id: "toggle-agent",
        label: "Toggle agent panel",
        category: "View",
        shortcut: modShortcut("L"),
        icon: <PanelRight size={14} />,
        run: () => paletteActionsRef.current.setAgentOpen((o) => !o),
      },
      {
        id: "preview",
        label: "Toggle preview",
        category: "View",
        icon: <Eye size={14} />,
        run: () => setPreviewMode((p) => !p),
      },
      {
        id: "zen",
        label: "Toggle Zen mode",
        category: "View",
        icon: <Expand size={14} />,
        run: () => setZenMode((z) => !z),
      },
      {
        id: "settings",
        label: "Settings",
        category: "View",
        icon: <Settings size={14} />,
        run: () => setSettingsOpen(true),
      },
      {
        id: "palette",
        label: "Command palette",
        category: "View",
        keywords: ["commands", "palette", "search"],
        shortcut: modShiftShortcut("P"),
        run: () => paletteActionsRef.current.setPaletteOpen(true),
      },
      {
        id: "quick-ai",
        label: "Quick AI (current section)",
        category: "AI",
        shortcut: modShortcut("K"),
        run: () => {
          const cur = editorRef.current?.getCursorMarkdownSection();
          paletteActionsRef.current.setQuickSectionTitle(cur?.title ?? "(no section)");
          paletteActionsRef.current.setQuickAIOpen(true);
        },
      },
      {
        id: "auto-section-ai",
        label: "Auto-section document with AI",
        category: "AI",
        keywords: ["ai", "headings", "structure", "outline"],
        icon: <ListTree size={14} />,
        run: () => paletteActionsRef.current.runAutoSection(),
      },
    ],
    [],
  );

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const outlineDragRef = useRef<{ startX: number; startW: number } | null>(null);

  return (
    <Flex direction="column" h="100vh" overflow="hidden">
      {!zenMode && (
        <TitleBar
          title={docTitle(filePath)}
          dirty={dirty}
          recentFiles={recentFiles}
          onRefreshRecents={() => void refreshRecents()}
          onNewBlank={newDoc}
          onTemplateNew={() => {
            setShowWelcome(false);
            setTemplatePickerOpen(true);
          }}
          onOpenBrowse={() => void openDoc()}
          onOpenRecent={(p) => void loadPathIntoEditor(p)}
          onSave={() => void save()}
          onSaveAs={() => void saveAs()}
          onSettings={() => setSettingsOpen(true)}
          onOpenTemplates={() => {
            setShowWelcome(false);
            setTemplatePickerOpen(true);
          }}
          onTemplateManager={() => setTemplateMgrOpen(true)}
          onExportAiPdf={window.markAPI ? exportAiPdfFromTitleBar : undefined}
          aiPdfExportBusy={aiPdfExportBusy}
        />
      )}
      <Flex flex="1" direction="column" minH={0} overflow="hidden">
        {!zenMode && (
          <EditorToolbar
            editorRef={editorRef}
            agentOpen={agentOpen}
            onToggleAgent={() => setAgentOpen((o) => !o)}
            sectionHoverHighlight={sectionHoverHighlight}
            onToggleSectionHoverHighlight={() => setSectionHoverHighlight((v) => !v)}
          />
        )}
        <Flex flex="1" minH={0} overflow="hidden">
          {!zenMode && !showWelcome && sectionHoverHighlight && (
            <>
              <Flex
                direction="column"
                w={`${outlineWidth}px`}
                flexShrink={0}
                minW={0}
                minH={0}
                h="full"
                overflow="hidden"
              >
                <DocumentOutline
                  tree={outline}
                  activeSectionId={outlineActiveSectionId}
                  onPick={onOutlinePick}
                  onAddToChat={addSectionToChat}
                />
              </Flex>
              <Box
                role="separator"
                aria-orientation="vertical"
                w="12px"
                flexShrink={0}
                alignSelf="stretch"
                cursor="col-resize"
                position="relative"
                zIndex={1}
                ml="-6px"
                mr="-6px"
                onMouseEnter={() => setOutlineResizerHover(true)}
                onMouseLeave={() => setOutlineResizerHover(false)}
                onMouseDown={(e) => {
                  outlineDragRef.current = { startX: e.clientX, startW: outlineWidth };
                  const onMove = (ev: MouseEvent) => {
                    if (!outlineDragRef.current) return;
                    const dx = ev.clientX - outlineDragRef.current.startX;
                    const next = Math.min(420, Math.max(160, outlineDragRef.current.startW + dx));
                    setOutlineWidth(next);
                  };
                  const onUp = () => {
                    outlineDragRef.current = null;
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              >
                <Box
                  position="absolute"
                  left="50%"
                  top={0}
                  bottom={0}
                  w="1px"
                  transform="translateX(-50%)"
                  bg="border.muted"
                  pointerEvents="none"
                />
                <Flex
                  className="resizer-grip"
                  position="absolute"
                  left="50%"
                  top="50%"
                  transform="translate(-50%, -50%)"
                  direction="column"
                  gap="3px"
                  opacity={outlineResizerHover ? 1 : 0}
                  transition="opacity 0.15s ease"
                  pointerEvents="none"
                  py={1}
                >
                  <Box w="3px" h="3px" borderRadius="full" bg="fg.muted" />
                  <Box w="3px" h="3px" borderRadius="full" bg="fg.muted" />
                  <Box w="3px" h="3px" borderRadius="full" bg="fg.muted" />
                </Flex>
              </Box>
            </>
          )}
          <Flex flex="1" minW={0} minH={0} direction="column">
            {showWelcome && !zenMode ? (
              <WelcomeScreen
                recentFiles={recentFiles}
                onStartWriting={() => setShowWelcome(false)}
                onOpen={() => void openDoc()}
                onNewFromTemplate={() => {
                  setShowWelcome(false);
                  setTemplatePickerOpen(true);
                }}
                onOpenRecent={(p) => void loadPathIntoEditor(p)}
              />
            ) : previewMode ? (
              <Box
                flex="1"
                overflow="auto"
                p={4}
                className={`md-prose md-prose-chat ${isDark ? "markapp-dark" : "markapp-light"}`}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc}</ReactMarkdown>
              </Box>
            ) : (
              <Box flex="1" minW={0} minH={0}>
                <PlateEditor
                  key={editorKey}
                  ref={editorRef}
                  initialMarkdown={doc}
                  isDark={isDark}
                  onMarkdownChange={onMarkdownChange}
                  onReady={() => {
                    syncCursor();
                    queueMicrotask(() => editorRef.current?.syncOutlineSections());
                  }}
                  onAddSectionToAgent={addSectionRefToAgent}
                  onAddSelectionToAgent={addSectionRefToAgent}
                  sectionHoverHighlight={sectionHoverHighlight}
                  activeSectionMarkdownFrom={activeSectionFrom}
                  onOutlineSectionsChange={setOutlineFromEditor}
                  outlineBootGeneration={editorKey}
                  proposalInline={editorProposalInline ?? undefined}
                  lastAssistantMarkdownRange={
                    lastAssistantChangeRange
                      ? {
                          from: lastAssistantChangeRange.from,
                          to: lastAssistantChangeRange.to,
                        }
                      : null
                  }
                  onProposalAccept={acceptProposal}
                  onProposalRevert={revertProposal}
                />
              </Box>
            )}
          </Flex>
          {agentOpen && !zenMode && (
            <>
              <Box
                role="separator"
                aria-orientation="vertical"
                w="12px"
                flexShrink={0}
                alignSelf="stretch"
                cursor="col-resize"
                position="relative"
                zIndex={1}
                ml="-6px"
                mr="-6px"
                onMouseEnter={() => setResizerHover(true)}
                onMouseLeave={() => setResizerHover(false)}
                onMouseDown={(e) => {
                  dragRef.current = { startX: e.clientX, startW: agentWidth };
                  const onMove = (ev: MouseEvent) => {
                    if (!dragRef.current) return;
                    const dx = dragRef.current.startX - ev.clientX;
                    const next = Math.min(560, Math.max(260, dragRef.current.startW + dx));
                    setAgentWidth(next);
                  };
                  const onUp = () => {
                    dragRef.current = null;
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              >
                <Box
                  position="absolute"
                  left="50%"
                  top={0}
                  bottom={0}
                  w="1px"
                  transform="translateX(-50%)"
                  bg="border.muted"
                  pointerEvents="none"
                />
                <Flex
                  className="resizer-grip"
                  position="absolute"
                  left="50%"
                  top="50%"
                  transform="translate(-50%, -50%)"
                  direction="column"
                  gap="3px"
                  opacity={resizerHover ? 1 : 0}
                  transition="opacity 0.15s ease"
                  pointerEvents="none"
                  py={1}
                >
                  <Box w="3px" h="3px" borderRadius="full" bg="fg.muted" />
                  <Box w="3px" h="3px" borderRadius="full" bg="fg.muted" />
                  <Box w="3px" h="3px" borderRadius="full" bg="fg.muted" />
                </Flex>
              </Box>
              <Flex
                direction="column"
                w={`${agentWidth}px`}
                flexShrink={0}
                minW={0}
                minH={0}
                h="full"
                overflow="hidden"
              >
                <AgentPanel
                  messages={messages}
                  streamingText={streamingText}
                  documentIsBlank={isEffectivelyBlankDocument(doc)}
                  documentMarkdown={doc}
                  contextSections={contextSections}
                  onRemoveContext={(id) => {
                    setContextSections((s) => s.filter((x) => x.id !== id));
                  }}
                  onAddSection={(s) => setContextSections((p) => (p.some((x) => x.id === s.id) ? p : [...p, s]))}
                  allSections={allSectionRefs}
                  mentionDocument={mentionDocument}
                  mentionClipboard={mentionClipboard}
                  onToggleDocument={setMentionDocument}
                  onToggleClipboard={setMentionClipboard}
                  busy={agentBusy}
                  onSend={(t) => void sendAgentMessage(t)}
                  onClosePanel={() => setAgentOpen(false)}
                  onClearChat={clearChat}
                  onAcceptProposal={acceptProposal}
                  onRevertProposal={revertProposal}
                />
              </Flex>
            </>
          )}
        </Flex>
      </Flex>
      {!zenMode && !showWelcome && (
        <StatusBar
          sectionCount={sectionCount}
          words={wordCount}
          activeHeading={activeHeading}
          agentStatus={agentBusy ? "Claude…" : streamingText ? "Receiving…" : null}
        />
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AiPdfExportDialog
        open={aiPdfDlgOpen}
        busy={aiPdfExportBusy}
        progress={aiPdfProgress}
        status={aiPdfStatus}
        error={aiPdfError}
        onOpenChange={(open) => {
          if (!open && aiPdfExportBusy) return;
          setAiPdfDlgOpen(open);
          if (!open) {
            setAiPdfError(null);
            setAiPdfProgress(0);
            setAiPdfStatus("");
          }
        }}
      />
      <TemplatePicker
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onCreateFromMarkdown={(md) => {
          setFilePath(null);
          setDoc(md);
          setDirty(true);
          setEditorKey((k) => k + 1);
        }}
      />
      <TemplateManager open={templateMgrOpen} onClose={() => setTemplateMgrOpen(false)} />
      <QuickAIDialog
        open={quickAIOpen}
        onClose={() => setQuickAIOpen(false)}
        sectionTitle={quickSectionTitle}
        onRun={quickAIRun}
      />
      <SaveAsTemplateDialog
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        onSave={(name) => { void saveAsTemplate(name); setSaveTemplateOpen(false); }}
      />
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Save As Template dialog
// ---------------------------------------------------------------------------
function SaveAsTemplateDialog(props: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");

  const handleSave = () => {
    props.onSave(name);
    setName("");
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={(e) => !e.open && props.onClose()} size="sm">
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" />
        <Dialog.Positioner>
          <Dialog.Content
            maxW="360px"
            bg={{ _light: "white", _dark: "gray.800" }}
            borderWidth="1px"
            borderColor={{ _light: "gray.200", _dark: "gray.600" }}
            shadow="lg"
          >
            <Box p={4} borderBottomWidth="1px" borderColor={{ _light: "gray.200", _dark: "gray.600" }}>
              <Text fontWeight="bold">Save as template</Text>
              <Text fontSize="xs" color="fg.muted" mt={1}>
                Saves the current document as a reusable template.
              </Text>
            </Box>
            <VStack align="stretch" p={4} gap={3}>
              <Field.Root>
                <Field.Label>Template name</Field.Label>
                <Input
                  size="sm"
                  variant="outline"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my_template"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                  autoFocus
                  bg={{ _light: "white", _dark: "gray.900" }}
                  borderColor={{ _light: "gray.300", _dark: "gray.500" }}
                />
              </Field.Root>
              <Flex gap={2} justify="flex-end">
                <Button variant="ghost" size="sm" onClick={props.onClose}>Cancel</Button>
                <Button colorPalette="blue" size="sm" onClick={handleSave}>Save</Button>
              </Flex>
            </VStack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
