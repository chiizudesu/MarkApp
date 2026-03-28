import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@chakra-ui/react";
import { useColorMode } from "@/components/ui/color-mode";
import { PlateEditor, type PlateEditorHandle } from "@/components/Editor/PlateEditor";
import { EditorToolbar } from "@/components/Editor/EditorToolbar";
import { TitleBar } from "@/components/Layout/TitleBar";
import { StatusBar } from "@/components/Layout/StatusBar";
import { CommandPalette, type CommandItem } from "@/components/Layout/CommandPalette";
import { DocumentOutline } from "@/components/Layout/DocumentOutline";
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

  const [proposal, setProposal] = useState<{ oldText: string; newText: string } | null>(null);

  const chatHistoryRef = useRef<MessageParam[]>([]);

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
    try {
      await writeTextFile(filePath, doc);
      setDirty(false);
    } catch (e) {
      alert((e as Error).message);
    }
  }, [filePath, doc]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    void (async () => {
      const ms = (await window.markAPI?.getStore("autoSaveMs")) as number | undefined;
      const delay = typeof ms === "number" && ms > 0 ? ms : 30000;
      const tick = () => {
        if (filePath && dirty) void persistDoc();
      };
      t = setInterval(tick, delay);
    })();
    return () => clearInterval(t);
  }, [filePath, dirty, persistDoc, doc]);

  const newDoc = () => {
    setFilePath(null);
    setDoc("# \n");
    setDirty(false);
    setEditorKey((k) => k + 1);
    setProposal(null);
    setContextSections([]);
    setMentionDocument(false);
    setMentionClipboard(false);
    void loadChat(null);
  };

  const openDoc = async () => {
    const p = await openFileDialog();
    if (!p) return;
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
      void loadChat(p);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const save = async () => {
    if (filePath) {
      await persistDoc();
      return;
    }
    const p = await saveFileDialog();
    if (!p) return;
    setFilePath(p);
    try {
      await writeTextFile(p, doc);
      setDirty(false);
      await pushRecent(p);
      void loadChat(p);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
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
      void loadChat(p);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const onMarkdownChange = (md: string) => {
    setDoc(md);
    setDirty(true);
    if (proposal) {
      setProposal(null);
    }
  };

  const addSectionToChat = (from: number, _title: string) => {
    const sec = sections.find((s) => s.from === from);
    if (!sec) return;
    const ref = sectionToRef(sec);
    setContextSections((prev) => (prev.some((p) => p.id === ref.id) ? prev : [...prev, ref]));
  };

  const addSectionRefToAgent = (ref: SectionRef) => {
    setContextSections((prev) => (prev.some((p) => p.id === ref.id) ? prev : [...prev, ref]));
  };

  const acceptProposal = () => {
    if (!proposal) return;
    const handle = editorRef.current;
    if (!handle) return;
    handle.setMarkdown(proposal.newText.includes("# ") ? proposal.newText : doc.replace(proposal.oldText, proposal.newText));
    setProposal(null);
    const newMd = handle.getMarkdown();
    setDoc(newMd);
    setDirty(true);
  };

  const rejectProposal = () => {
    setProposal(null);
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
          ? { oldText: contextSections[0].content, newText: cleaned }
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
        setProposal({ oldText: sectionProposal.oldText, newText: sectionProposal.newText });
      }
    } catch (e) {
      alert((e as Error).message);
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
      setProposal({ oldText: sec.content, newText: cleaned });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setAgentBusy(false);
    }
  };

  const copyWholeDoc = async () => {
    await navigator.clipboard.writeText(doc);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        void save();
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
      { id: "new ", label: "New document", keywords: ["clear"], run: newDoc },
      { id: "open", label: "Open…", run: () => void openDoc() },
      { id: "save", label: "Save", run: () => void save() },
      { id: "saveas", label: "Save as…", run: () => void saveAs() },
      { id: "toggle-agent", label: "Toggle agent panel", run: () => setAgentOpen((o) => !o) },
      {
        id: "quick-ai",
        label: "Quick AI (current section)",
        run: () => {
          const heading = findCurrentSection();
          setQuickSectionTitle(heading?.title ?? "(no section)");
          setQuickAIOpen(true);
        },
      },
      { id: "settings", label: "Settings", run: () => setSettingsOpen(true) },
      { id: "template", label: "New from template", run: () => setTemplatePickerOpen(true) },
      { id: "tpl-mgr", label: "Template manager", run: () => setTemplateMgrOpen(true) },
      { id: "preview", label: "Toggle preview", run: () => setPreviewMode((p) => !p) },
      { id: "zen", label: "Toggle Zen mode", run: () => setZenMode((z) => !z) },
      { id: "copy-doc", label: "Copy entire document", run: () => void copyWholeDoc() },
      {
        id: "auto-section-ai",
        label: "Auto-section document with AI",
        keywords: ["headings", "structure", "outline"],
        run: () =>
          void (async () => {
            const secs = getSectionsFromText(doc);
            const onlyRoot = secs.length === 1 && secs[0]?.level === 0;
            if (!onlyRoot) {
              alert("Document already has section headings.");
              return;
            }
            setAgentBusy(true);
            try {
              const next = await autoSectionDocument(doc);
              editorRef.current?.setMarkdown(next);
              setDoc(next);
              setDirty(true);
            } catch (e) {
              alert((e as Error).message);
            } finally {
              setAgentBusy(false);
            }
          })(),
      },
    ],
    [doc, findCurrentSection],
  );

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  return (
    <Flex direction="column" h="100vh" overflow="hidden">
      {!zenMode && (
        <TitleBar
          title={docTitle(filePath)}
          dirty={dirty}
          onNew={newDoc}
          onOpen={() => void openDoc()}
          onSave={() => void save()}
          onSaveAs={() => void saveAs()}
          onTemplateNew={() => setTemplatePickerOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onTemplateManager={() => setTemplateMgrOpen(true)}
        />
      )}
      <Flex flex="1" direction="column" minH={0} overflow="hidden">
        {!zenMode && <EditorToolbar editorRef={editorRef} />}
        <Flex flex="1" minH={0} overflow="hidden">
          <Flex flex="1" minW={0} minH={0} direction="column">
            {previewMode ? (
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
                />
              </Box>
            )}
          </Flex>
          {agentOpen && !zenMode && (
            <>
              <Box
                w="4px"
                cursor="col-resize"
                flexShrink={0}
                alignSelf="stretch"
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
                bg="gray.300"
                _dark={{ bg: "gray.600" }}
              />
              <Flex
                direction="column"
                w={`${agentWidth}px`}
                flexShrink={0}
                minW={0}
                minH={0}
                h="full"
                overflow="hidden"
              >
                <Box flexShrink={0}>
                  <DocumentOutline
                    tree={outline}
                    activeFrom={activeSectionFrom}
                    onPick={(_from, title) => {
                      editorRef.current?.scrollToHeading(title ?? "");
                      syncCursor();
                    }}
                    onAddToChat={addSectionToChat}
                  />
                </Box>
                <Box flex="1" minH={0} display="flex" flexDirection="column" overflow="hidden">
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
                    proposal={proposal ? { oldText: proposal.oldText, newText: proposal.newText } : null}
                    onAcceptProposal={acceptProposal}
                    onRejectProposal={rejectProposal}
                  />
                </Box>
              </Flex>
            </>
          )}
        </Flex>
      </Flex>
      {!zenMode && (
        <StatusBar
          words={wordCount}
          activeHeading={activeHeading}
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
