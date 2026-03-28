import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Value } from "platejs";
import { Range as SlateRange } from "slate";
import { MarkdownPlugin } from "@platejs/markdown";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import remarkGfm from "remark-gfm";
import { Menu, Portal, Box, IconButton } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { insertImageFromFiles } from "@platejs/media";
import { editorPlugins } from "./platePlugins";
import {
  getSectionBlockIndexRangeForTopLevelIndex,
  headingLevelFromType,
  type DocSection,
} from "@/services/sectionService";
import type { SectionRef } from "@/types/agent";

export type PlateEditorHandle = {
  getEditor: () => ReturnType<typeof usePlateEditor> | null;
  setMarkdown: (md: string) => void;
  getMarkdown: () => string;
  scrollToHeading: (headingText: string) => void;
};

function sectionToRef(s: DocSection): SectionRef {
  return {
    id: s.id,
    title: s.title,
    content: s.content,
    from: s.from,
    to: s.to,
  };
}

type Props = {
  initialMarkdown: string;
  /** When true, only the outer “desk” around the page uses a dark tint; the page stays light. */
  isDark: boolean;
  onMarkdownChange: (md: string) => void;
  onReady?: () => void;
  sections: DocSection[];
  onAddSectionToAgent: (ref: SectionRef) => void;
  onAddSelectionToAgent: (ref: SectionRef) => void;
};

export const PlateEditor = forwardRef<PlateEditorHandle, Props>(function PlateEditor(
  {
    initialMarkdown,
    isDark,
    onMarkdownChange,
    onReady,
    sections,
    onAddSectionToAgent,
    onAddSelectionToAgent,
  },
  ref,
) {
  const readyFired = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const lastContextNativeEventRef = useRef<MouseEvent | null>(null);
  const hoverRaf = useRef<number | null>(null);
  /** True while a pointer is down on the editor scroll area (selection drag, click-hold). */
  const editorPointerDownRef = useRef(false);
  const [hoverRegion, setHoverRegion] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [hoverSectionBlocks, setHoverSectionBlocks] = useState<{ b0: number; b1: number } | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [editorZoom, setEditorZoom] = useState(1);

  const editor = usePlateEditor({
    plugins: editorPlugins,
    value: (ed) =>
      ed.getApi(MarkdownPlugin).markdown.deserialize(initialMarkdown, {
        remarkPlugins: [remarkGfm],
      }),
  });

  const serializeToMarkdown = useCallback((): string => {
    try {
      return editor.getApi(MarkdownPlugin).markdown.serialize({ value: editor.children as Value });
    } catch {
      return "";
    }
  }, [editor]);

  useImperativeHandle(ref, () => ({
    getEditor: () => editor,
    setMarkdown: (md: string) => {
      const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(md, {
        remarkPlugins: [remarkGfm],
      });
      editor.tf.reset();
      editor.tf.setValue(nodes);
    },
    getMarkdown: serializeToMarkdown,
    scrollToHeading: (headingText: string) => {
      const headingTypes = ["h1", "h2", "h3", "h4", "h5", "h6"];
      for (const [node, path] of editor.api.nodes({
        at: [],
        match: (n: any) => headingTypes.includes(n.type),
      })) {
        const text = editor.api.string(node as any);
        if (text.trim() === headingText.trim()) {
          editor.tf.select(path);
          editor.tf.focus();
          const domNode = editor.api.toDOMNode(node as any);
          if (domNode) {
            domNode.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          return;
        }
      }
    },
  }));

  const handleChange = useCallback(
    ({ value }: { value: Value }) => {
      if (!readyFired.current) {
        readyFired.current = true;
        onReady?.();
      }
      try {
        const md = editor.getApi(MarkdownPlugin).markdown.serialize({ value });
        onMarkdownChange(md);
      } catch {
        // serialization may fail transiently during rapid edits
      }
    },
    [editor, onMarkdownChange, onReady],
  );

  const liveSectionFromBlockRange = useCallback(
    (b0: number, b1: number): DocSection | null => {
      const children = editor.children as Value;
      if (b0 > b1 || b0 < 0 || b1 >= children.length) return null;
      const first = children[b0] as { type?: string };
      const hl = headingLevelFromType(first?.type);
      const title = hl > 0 ? editor.api.string(first as any) : "(Document)";
      const frag = children.slice(b0, b1 + 1) as Value;
      let content: string;
      try {
        content = editor.getApi(MarkdownPlugin).markdown.serialize({ value: frag });
      } catch {
        return null;
      }
      const match = sections.find((s) => s.title.trim() === title.trim());
      if (match) return { ...match, content };
      return {
        id: `sec-live-${b0}`,
        title,
        level: hl,
        from: 0,
        to: 0,
        content,
      };
    },
    [editor, sections],
  );

  const updateHoverRegion = useCallback(
    (e: React.MouseEvent) => {
      if (contextMenuOpen) return;
      // Avoid setState while the user is holding a mouse button (text selection drag).
      // Re-rendering the editor chrome during selection fights the browser/Slate and can
      // collapse or snap the selection when crossing section bounds or leaving the scroll area.
      if (e.buttons !== 0) return;
      if (hoverRaf.current != null) return;
      hoverRaf.current = requestAnimationFrame(() => {
        hoverRaf.current = null;
        if (editorPointerDownRef.current) return;
        const range = editor.api.findEventRange(e.nativeEvent);
        const pageEl = pageRef.current;
        if (!range || !pageEl) {
          setHoverRegion(null);
          setHoverSectionBlocks(null);
          return;
        }
        const point = SlateRange.isCollapsed(range) ? range.anchor : range.focus;
        const block = editor.api.block({ at: point, highest: true });
        if (!block) {
          setHoverRegion(null);
          setHoverSectionBlocks(null);
          return;
        }
        const blockIndex = block[1][0]!;
        const [b0, b1] = getSectionBlockIndexRangeForTopLevelIndex(
          editor.children as Array<{ type?: string }>,
          blockIndex,
        );
        let top: number | null = null;
        let bottom: number | null = null;
        let left: number | null = null;
        let right: number | null = null;
        const pr = pageEl.getBoundingClientRect();
        for (let i = b0; i <= b1 && i < editor.children.length; i++) {
          const node = editor.children[i];
          const dom = editor.api.toDOMNode(node as any);
          if (!dom) continue;
          const br = dom.getBoundingClientRect();
          const t = br.top - pr.top;
          const b = br.bottom - pr.top;
          const l = br.left - pr.left;
          const r = br.right - pr.left;
          if (top === null || t < top) top = t;
          if (bottom === null || b > bottom) bottom = b;
          if (left === null || l < left) left = l;
          if (right === null || r > right) right = r;
        }
        if (top === null || bottom === null || left === null || right === null) {
          setHoverRegion(null);
          setHoverSectionBlocks(null);
          return;
        }
        const pad = 6;
        setHoverSectionBlocks({ b0, b1 });
        setHoverRegion({
          top: top - pad,
          left: left - pad,
          width: Math.max(12, right - left + pad * 2),
          height: Math.max(12, bottom - top + pad * 2),
        });
      });
    },
    [contextMenuOpen, editor],
  );

  const clearHoverRegion = useCallback(() => {
    if (contextMenuOpen) return;
    setHoverRegion(null);
    setHoverSectionBlocks(null);
  }, [contextMenuOpen]);

  useEffect(() => () => {
    if (hoverRaf.current != null) cancelAnimationFrame(hoverRaf.current);
  }, []);

  useEffect(() => {
    const endPointer = () => {
      editorPointerDownRef.current = false;
    };
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    return () => {
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
    };
  }, []);

  const ZOOM_STEP = 0.1;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 3;

  const clampZoom = (z: number) =>
    Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setEditorZoom((z) => clampZoom(z + delta));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const t = e.target as Node | null;
      if (!t || !root.contains(t)) return;
      if (e.code === "Equal" || e.code === "NumpadAdd") {
        e.preventDefault();
        setEditorZoom((z) => clampZoom(z + ZOOM_STEP));
        return;
      }
      if (e.code === "Minus" || e.code === "NumpadSubtract") {
        e.preventDefault();
        setEditorZoom((z) => clampZoom(z - ZOOM_STEP));
        return;
      }
      if (e.code === "Digit0" || e.code === "Numpad0") {
        e.preventDefault();
        setEditorZoom(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const getSelectionMarkdown = useCallback((): string | null => {
    const sel = editor.selection;
    if (!sel || SlateRange.isCollapsed(sel)) return null;
    const fragment = editor.api.getFragment(sel);
    if (!fragment?.length) return null;
    try {
      return editor.getApi(MarkdownPlugin).markdown.serialize({ value: fragment as Value });
    } catch {
      return null;
    }
  }, [editor]);

  const runCopy = useCallback(async () => {
    const md = getSelectionMarkdown();
    if (md != null && md.length > 0) await navigator.clipboard.writeText(md);
  }, [getSelectionMarkdown]);

  const runCut = useCallback(async () => {
    await runCopy();
    if (editor.selection && !SlateRange.isCollapsed(editor.selection)) {
      editor.tf.deleteFragment();
    }
  }, [editor, runCopy]);

  const runPaste = useCallback(async () => {
    editor.tf.focus();
    try {
      const clipItems = await navigator.clipboard.read();
      for (const item of clipItems) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            const file = new File([blob], "paste", { type: blob.type || type });
            const xfer = new DataTransfer();
            xfer.items.add(file);
            insertImageFromFiles(editor, xfer.files);
            return;
          }
        }
      }
    } catch {
      /* fall through to text */
    }
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    if (!text) return;
    const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(text, {
      remarkPlugins: [remarkGfm],
    });
    editor.tf.insertFragment(nodes);
  }, [editor]);

  const runSelectAll = useCallback(() => {
    editor.tf.focus();
    const anchor = editor.api.start([]);
    const focus = editor.api.end([]);
    if (anchor && focus) {
      editor.tf.select({ anchor, focus });
    }
  }, [editor]);

  const sectionAtContext = useCallback((): DocSection | null => {
    const ev = lastContextNativeEventRef.current;
    if (!ev) return null;
    const range = editor.api.findEventRange(ev);
    if (!range) return null;
    const point = SlateRange.isCollapsed(range) ? range.anchor : range.focus;
    const block = editor.api.block({ at: point, highest: true });
    if (!block) return null;
    const blockIndex = block[1][0]!;
    const [b0, b1] = getSectionBlockIndexRangeForTopLevelIndex(
      editor.children as Array<{ type?: string }>,
      blockIndex,
    );
    return liveSectionFromBlockRange(b0, b1);
  }, [editor, liveSectionFromBlockRange]);

  const runAddSection = useCallback(() => {
    const sec = sectionAtContext();
    if (!sec) return;
    onAddSectionToAgent(sectionToRef(sec));
  }, [onAddSectionToAgent, sectionAtContext]);

  const runAddSelection = useCallback(() => {
    const md = getSelectionMarkdown();
    if (!md?.trim()) return;
    onAddSelectionToAgent({
      id: `sel-${Date.now()}`,
      title: "(Selection)",
      content: md,
      from: 0,
      to: 0,
    });
  }, [getSelectionMarkdown, onAddSelectionToAgent]);

  const runAddHoveredSection = useCallback(() => {
    const hb = hoverSectionBlocks;
    if (!hb) return;
    const sec = liveSectionFromBlockRange(hb.b0, hb.b1);
    if (!sec) return;
    onAddSectionToAgent(sectionToRef(sec));
  }, [hoverSectionBlocks, liveSectionFromBlockRange, onAddSectionToAgent]);

  const handleEditorPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const fromFiles =
        dt.files && dt.files.length > 0
          ? Array.from(dt.files).filter((f) => f.type.startsWith("image/"))
          : [];
      const fromItems: File[] = [];
      for (const item of dt.items ?? []) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) fromItems.push(f);
        }
      }
      const imageFiles = fromFiles.length > 0 ? fromFiles : fromItems;
      if (imageFiles.length === 0) return;
      e.preventDefault();
      const xfer = new DataTransfer();
      for (const f of imageFiles) xfer.items.add(f);
      insertImageFromFiles(editor, xfer.files);
    },
    [editor],
  );

  return (
    <Plate editor={editor} onValueChange={handleChange}>
      <Menu.Root
        onOpenChange={(d: { open: boolean }) => {
          setContextMenuOpen(d.open);
          if (!d.open) lastContextNativeEventRef.current = null;
        }}
      >
        <Menu.ContextTrigger asChild>
          <Box
            ref={wrapRef}
            className="markapp-editor-scroll"
            data-chrome={isDark ? "dark" : "light"}
            position="relative"
            h="100%"
            minH={0}
            overflowY="auto"
            overflowX="hidden"
            bg={isDark ? "#2b2b2b" : "#d9d9d9"}
            py={{ base: 6, md: 8 }}
            px={{ base: 3, md: 6 }}
            onPointerDownCapture={(e) => {
              if (wrapRef.current?.contains(e.target as Node)) editorPointerDownRef.current = true;
            }}
            onMouseMove={updateHoverRegion}
            onMouseLeave={(e) => {
              if (e.buttons !== 0 || editorPointerDownRef.current) return;
              clearHoverRegion();
            }}
            onContextMenu={(e) => {
              lastContextNativeEventRef.current = e.nativeEvent;
            }}
          >
            <Box
              ref={pageRef}
              position="relative"
              mx="auto"
              maxW="816px"
              w="100%"
              minH="1056px"
              bg="white"
              borderRadius="2px"
              boxShadow={
                isDark
                  ? "0 4px 24px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.12)"
                  : "0 2px 6px rgba(0,0,0,0.06), 0 8px 28px rgba(0,0,0,0.08)"
              }
              borderWidth="1px"
              borderColor="blackAlpha.100"
              px={{ base: 8, md: "72px" }}
              pt={{ base: 10, md: "72px" }}
              pb={{ base: 16, md: "96px" }}
              /* Scales the whole “sheet” + Slate surface (Word-style); desk bg outside is untouched. */
              style={{ zoom: editorZoom }}
            >
              {hoverRegion && (
                <Box
                  position="absolute"
                  top={`${hoverRegion.top}px`}
                  left={`${hoverRegion.left}px`}
                  w={`${hoverRegion.width}px`}
                  h={`${hoverRegion.height}px`}
                  borderWidth="1px"
                  borderStyle="solid"
                  borderColor="rgba(126, 58, 242, 0.65)"
                  borderRadius="lg"
                  bg="rgba(139, 92, 246, 0.07)"
                  pointerEvents="none"
                  zIndex={1}
                  boxSizing="border-box"
                >
                  <IconButton
                    aria-label="Add section to agent chat"
                    size="xs"
                    variant="outline"
                    colorPalette="purple"
                    pointerEvents="auto"
                    position="absolute"
                    top="-2px"
                    right="-2px"
                    borderRadius="md"
                    minW="22px"
                    h="22px"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      runAddHoveredSection();
                    }}
                  >
                    <Plus size={14} />
                  </IconButton>
                </Box>
              )}
              <PlateContent
                className="markapp-plate-content markapp-light"
                placeholder="Start writing..."
                onPaste={handleEditorPaste}
                style={{
                  minHeight: "min(70vh, 900px)",
                  outline: "none",
                  fontFamily:
                    '"Segoe UI", "Calibri", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif',
                  fontSize: "11pt",
                  lineHeight: 1.5,
                }}
              />
            </Box>
          </Box>
        </Menu.ContextTrigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content minW="240px">
              <Menu.Item value="cut" onSelect={() => void runCut()}>
                Cut
              </Menu.Item>
              <Menu.Item value="copy" onSelect={() => void runCopy()}>
                Copy
              </Menu.Item>
              <Menu.Item value="paste" onSelect={() => void runPaste()}>
                Paste
              </Menu.Item>
              <Menu.Item value="select-all" onSelect={runSelectAll}>
                Select all
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item value="add-section" onSelect={runAddSection}>
                Add section to agent
              </Menu.Item>
              <Menu.Item value="add-selection" onSelect={runAddSelection}>
                Add selection to agent
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
    </Plate>
  );
});
