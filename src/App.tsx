import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@chakra-ui/react";
import { useColorMode } from "@/components/ui/color-mode";
import { PlateEditor, type PlateEditorHandle } from "@/components/Editor/PlateEditor";
import { EditorToolbar } from "@/components/Editor/EditorToolbar";
import { TitleBar } from "@/components/Layout/TitleBar";
import { StatusBar } from "@/components/Layout/StatusBar";
import { WelcomeScreen } from "@/components/Layout/WelcomeScreen";
import { CommandPalette, type CommandItem } from "@/components/Layout/CommandPalette";
import { DocumentOutline } from "@/components/Layout/DocumentOutline";
import { toaster } from "@/components/ui/toaster";
import { modShortcut, modShiftShortcut } from "@/utils/platform";
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
import { getSectionsFromText, buildOutline, type DocSection } from "@/services/sectionService";
import {
  streamAgentTurn,
  streamSectionReplace,
  buildAgentUserPayload,
  autoSectionDocument,
  summarizeSectionChanges,
} from "@/services/claude";
import type { MessageParam } from "@anthropic-ai/sdk/resources";
import { Point } from "slate";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, SectionRef } from "@/types/agent";
import { stripOuterMarkdownCodeFence } from "@/utils/markdownFence";

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

function chatSidecarPath(filePath: string | null) {
  if (!filePath) return null;
  return `${filePath}.markapp.chat.json`;
}

export function App() {
  const { colorMode } = useColorMode();
  const isDark = colorMode === "dark";

  const editorRef = useRef<PlateEditorHandle>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [doc, setDoc] = useState("# Hello\n\nStart writing in **MarkApp**.\n");
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [contextSections, setContextSections] = useState<SectionRef[]>([]);
  const [mentionDocument, setMentionDocument] = useState(false);
  const [mentionClipboard, setMentionClipboard] = useState(false);

  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [showWelcome, setShowWelcome] = useState(true);
  const [resizerHover, setResizerHover] = useState(false);
  const [outlineWidth, setOutlineWidth] = useState(240);
  const [outlineResizerHover, setOutlineResizerHover] = useState(false);

  const chatHistoryRef = useRef<MessageParam[]>([]);

  const refreshRecents = useCallback(async () => {
    const r = (await window.markAPI?.getStore("recentFiles")) as string[] | undefined;
    setRecentFiles(r ?? []);
  }, []);

  useEffect(() => {
    void refreshRecents();
  }, [refreshRecents]);

  const sections = useMemo(() => getSectionsFromText(doc), [doc]);
  const outline = useMemo(() => buildOutline(sections.filter((s) => s.level > 0)), [sections]);
  const allSectionRefs = useMemo(() => sections.filter((s) => s.level > 0).map(sectionToRef), [sections]);

  const wordCount = useMemo(() => doc.trim().split(/\s+/).filter(Boolean).length, [doc]);

  useEffect(() => {
    window.markAPI?.setDirty(dirty);
  }, [dirty]);

  const findCurrentSection = useCallback(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor?.selection) return null;
    const headingTypes = ["h1", "h2", "h3", "h4", "h5", "h6"];
    let lastHeading: { title: string; from: number } | null = null;
    for (const [node, path] of editor.api.nodes({
      at: [],
      match: (n: any) => headingTypes.includes(n.type),
    })) {
      const point = { path, offset: 0 };
      if (Point.isBefore(point, editor.selection.anchor) || Point.equals(point, editor.selection.anchor)) {
        lastHeading = { title: editor.api.string(node as any), from: path[0] };
      }
    }
    return lastHeading;
  }, []);

  const syncCursor = useCallback(() => {
    const heading = findCurrentSection();
    setActiveHeading(heading?.title ?? null);

    const sec = heading ? sections.find((s) => s.title === heading.title) : null;
    setActiveSectionFrom(sec?.from ?? null);
  }, [findCurrentSection, sections]);

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
    void saveChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist when chat state changes
  }, [messages, contextSections, mentionDocument, mentionClipboard, filePath]);

  const persistDoc = useCallback(async () => {
    if (!filePath) return;
    await writeTextFile(filePath, doc);
    setDirty(false);
  }, [filePath, doc]);

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
    void loadChat(null);
  };

  const loadPathIntoEditor = async (p: string) => {
    try {
      let text = await readTextFile(p);
      const initialSecs = getSectionsFromText(text);
      const onlyRoot = initialSecs.length === 1 && initialSecs[0]?.level === 0;
      if (onlyRoot && text.trim().length >= 400) {
        try {
          setAgentBusy(true);
          text = await autoSectionDocument(text);
        } catch {
          /* keep original if API/key missing or request fails */
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
      await writeTextFile(p, doc);
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
      await writeTextFile(p, doc);
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

  const clearChat = () => {
    setMessages([]);
    chatHistoryRef.current = [];
    setStreamingText("");
  };

  const onMarkdownChange = (md: string) => {
    setDoc(md);
    setDirty(true);
  };

  const applySectionReplacementToEditor = useCallback((oldText: string, newText: string) => {
    const handle = editorRef.current;
    if (!handle) return;
    const current = handle.getMarkdown();
    const nextMd = newText.includes("# ") ? newText : current.replace(oldText, newText);
    handle.setMarkdown(nextMd);
    setDoc(handle.getMarkdown());
    setDirty(true);
  }, []);

  const addSectionToChat = (from: number, _title: string) => {
    const sec = sections.find((s) => s.from === from);
    if (!sec) return;
    const ref = sectionToRef(sec);
    setContextSections((prev) => (prev.some((p) => p.id === ref.id) ? prev : [...prev, ref]));
  };

  const addSectionRefToAgent = (ref: SectionRef) => {
    setContextSections((prev) => (prev.some((p) => p.id === ref.id) ? prev : [...prev, ref]));
  };

  const sendAgentMessage = async (text: string) => {
    let clip: string | null = null;
    if (mentionClipboard) {
      try {
        clip = await navigator.clipboard.readText();
      } catch {
        clip = "(clipboard unavailable)";
      }
    }
    const userContent = buildAgentUserPayload({
      instruction: text,
      fullDocument: doc,
      sections: contextSections,
      mentionDocument,
      mentionClipboard: mentionClipboard ? clip : null,
    });

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    chatHistoryRef.current.push({ role: "user", content: userContent });

    setAgentBusy(true);
    setStreamingText("");
    try {
      let full = "";
      await streamAgentTurn(
        [...chatHistoryRef.current],
        (chunk) => {
          full += chunk;
          setStreamingText(full);
        },
      );

      const cleaned = stripOuterMarkdownCodeFence(full);
      const sectionProposal =
        contextSections.length === 1 && cleaned
          ? {
              oldText: contextSections[0].content,
              newText: cleaned,
              sectionTitle: contextSections[0].title,
            }
          : undefined;

      const asst: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: cleaned,
        sectionProposal,
      };
      setMessages((m) => [...m, asst]);
      chatHistoryRef.current.push({ role: "assistant", content: cleaned });
      setStreamingText("");

      if (sectionProposal) {
        applySectionReplacementToEditor(sectionProposal.oldText, sectionProposal.newText);
        // Fire-and-forget: fetch AI bullet summary and patch the message once ready
        summarizeSectionChanges(
          sectionProposal.oldText,
          sectionProposal.newText,
          sectionProposal.sectionTitle ?? "Section",
        ).then((summary) => {
          if (!summary.length) return;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === asst.id && msg.sectionProposal
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
    const heading = findCurrentSection();
    const sec = heading
      ? sections.find((s) => s.title === heading.title)
      : sections[0] ?? null;
    if (!sec) return;
    setAgentBusy(true);
    try {
      let out = "";
      await streamSectionReplace(sec.content, instruction, (c) => {
        out += c;
      });
      const cleaned = stripOuterMarkdownCodeFence(out.trim());
      applySectionReplacementToEditor(sec.content, cleaned);
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
    await navigator.clipboard.writeText(doc);
    toaster.create({ type: "success", title: "Copied", description: "Entire document copied to clipboard." });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        void save();
      }
      if (mod && e.key.toLowerCase() === "o" && !e.shiftKey) {
        e.preventDefault();
        void openDoc();
      }
      if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        newDoc();
      }
      if (mod && e.key.toLowerCase() === "s" && e.shiftKey) {
        e.preventDefault();
        void saveAs();
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void copyWholeDoc();
      }
      if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setAgentOpen((o) => !o);
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const heading = findCurrentSection();
        setQuickSectionTitle(heading?.title ?? "(no section)");
        setQuickAIOpen(true);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, findCurrentSection]);

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: "new",
        label: "New document",
        category: "File",
        keywords: ["clear", "blank"],
        shortcut: modShortcut("N"),
        icon: <FilePlus size={14} />,
        run: newDoc,
      },
      {
        id: "open",
        label: "Open…",
        category: "File",
        shortcut: modShortcut("O"),
        icon: <FolderOpen size={14} />,
        run: () => void openDoc(),
      },
      {
        id: "save",
        label: "Save",
        category: "File",
        shortcut: modShortcut("S"),
        icon: <Save size={14} />,
        run: () => void save(),
      },
      {
        id: "saveas",
        label: "Save as…",
        category: "File",
        shortcut: modShiftShortcut("S"),
        icon: <SaveAll size={14} />,
        run: () => void saveAs(),
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
        run: () => setAgentOpen((o) => !o),
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
        run: () => setPaletteOpen(true),
      },
      {
        id: "quick-ai",
        label: "Quick AI (current section)",
        category: "AI",
        shortcut: modShortcut("K"),
        run: () => {
          const heading = findCurrentSection();
          setQuickSectionTitle(heading?.title ?? "(no section)");
          setQuickAIOpen(true);
        },
      },
      {
        id: "auto-section-ai",
        label: "Auto-section document with AI",
        category: "AI",
        keywords: ["ai", "headings", "structure", "outline"],
        icon: <ListTree size={14} />,
        run: () =>
          void (async () => {
            const secs = getSectionsFromText(doc);
            const onlyRoot = secs.length === 1 && secs[0]?.level === 0;
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
              const next = await autoSectionDocument(doc);
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
          })(),
      },
    ],
    [doc, findCurrentSection],
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
          onTemplateManager={() => setTemplateMgrOpen(true)}
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
          {!zenMode && !showWelcome && (
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
                  activeFrom={activeSectionFrom}
                  onPick={(_from, title) => {
                    editorRef.current?.scrollToHeading(title ?? "");
                    syncCursor();
                  }}
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
              <Box flex="1" overflow="auto" p={4} className="md-prose md-prose-chat">
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
                  onReady={() => syncCursor()}
                  sections={sections}
                  onAddSectionToAgent={addSectionRefToAgent}
                  onAddSelectionToAgent={addSectionRefToAgent}
                  sectionHoverHighlight={sectionHoverHighlight}
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
                />
              </Flex>
            </>
          )}
        </Flex>
      </Flex>
      {!zenMode && (
        <StatusBar
          words={wordCount}
          activeHeading={activeHeading}
          agentStatus={agentBusy ? "Claude…" : streamingText ? "Receiving…" : null}
          previewMode={previewMode}
          onTogglePreview={() => setPreviewMode((p) => !p)}
          zenMode={zenMode}
          onToggleZen={() => setZenMode((z) => !z)}
        />
      )}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
    </Flex>
  );
}
