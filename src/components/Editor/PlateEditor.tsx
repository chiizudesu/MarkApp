import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Value } from "platejs";
import { Range as SlateRange } from "slate";
import { MarkdownPlugin } from "@platejs/markdown";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { Menu, Portal, Box, IconButton, Flex, Text, HStack, Spinner, Button } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { modShiftShortcut } from "@/utils/platform";
import { insertImageFromFiles } from "@platejs/media";
import { editorPlugins } from "./platePlugins";
import { bumpEditorFontSize } from "@/utils/editorFontSize";
import {
  collectBoldOnlyParagraphHints,
  getSectionBlockIndexRangeForTopLevelIndex,
  getSectionAtPos,
  getSectionForEditorBlock,
  getSectionsFromTextWithBoldBlockHints,
  headingLevelFromType,
  topLevelBlocksIntersectingMarkdownRange,
  trimBlockSpanToSection,
  type DocSection,
  type OutlineBoldBlockHint,
} from "@/services/sectionService";
import type { SectionRef } from "@/types/agent";

/** Hit slop outside the purple outline (~20px requested; ≥22 so the sparkle, offset 22px, stays inside the zone). */
const SECTION_HOVER_OUTSIDE_PX = 22;


export type PlateEditorHandle = {
  getEditor: () => ReturnType<typeof usePlateEditor> | null;
  setMarkdown: (md: string) => void;
  getMarkdown: () => string;
  scrollToHeading: (headingText: string) => void;
  /** Markdown offset of the outline section containing the caret (level > 0 only). */
  getCursorMarkdownSection: () => { from: number; title: string } | null;
  /** Move caret to the start of the section that begins at this markdown offset and scroll it into view. */
  focusSectionAtMarkdownFrom: (markdownFrom: number) => void;
  /** Recompute outline sections (bold paragraphs + markdown) and notify App. */
  syncOutlineSections: () => void;
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
  /** When true, hovering the editor shows the current section outline and + to add to agent. */
  sectionHoverHighlight?: boolean;
  /**
   * Outline / caret sync: markdown offset of the active section’s start (same as `DocSection.from`).
   * Resolved inside the editor against live serialize + block starts so `to` matches `topLevelBlocksIntersectingMarkdownRange`
   * (avoids highlight ending early when App `sections` came from stale `doc`).
   */
  activeSectionMarkdownFrom?: number | null;
  /** Full section list (markdown + bold-only paragraphs); keeps sidebar aligned with WYSIWYG. */
  onOutlineSectionsChange?: (sections: DocSection[]) => void;
  /**
   * Pass App’s `editorKey` (or any int that bumps on remount / new file).
   * Plate may not emit `onValueChange` before first interaction; we sync outline once when this changes.
   */
  outlineBootGeneration?: number;
  /**
   * Cursor-style inline diff: highlight changed blocks + floating Keep/Undo (same as agent chat).
   * sectionFrom/sectionTo are the markdown offsets of the changed region (from the live sections list).
   * When both are -1 it means the whole document.
   */
  proposalInline?: {
    state: "streaming" | "pending";
    sectionTitle: string;
    messageId?: string;
    sectionFrom: number;
    sectionTo: number;
  };
  onProposalAccept?: (messageId: string) => void;
  onProposalRevert?: (messageId: string) => void;
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
    sectionHoverHighlight = true,
    activeSectionMarkdownFrom = null,
    onOutlineSectionsChange,
    outlineBootGeneration = 0,
    proposalInline,
    onProposalAccept,
    onProposalRevert,
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
  const [pinnedRegion, setPinnedRegion] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [pinnedSectionBlocks, setPinnedSectionBlocks] = useState<{ b0: number; b1: number } | null>(null);
  const [mouseInEditorChrome, setMouseInEditorChrome] = useState(false);
  const hoverRegionRef = useRef(hoverRegion);
  const hoverSectionBlocksRef = useRef(hoverSectionBlocks);
  /** Lazily rebuilt when serialized markdown changes — aligns block indices with getSectionsFromText. */
  const mdBlockStartsCacheRef = useRef<{ md: string; starts: number[] } | null>(null);
  const boldHintsRef = useRef<OutlineBoldBlockHint[]>([]);
  useEffect(() => {
    hoverRegionRef.current = hoverRegion;
  }, [hoverRegion]);
  useEffect(() => {
    hoverSectionBlocksRef.current = hoverSectionBlocks;
  }, [hoverSectionBlocks]);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [editorZoom, setEditorZoom] = useState(1);
  const [proposalLayout, setProposalLayout] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const editor = usePlateEditor({
    plugins: editorPlugins,
    value: (ed) => ed.getApi(MarkdownPlugin).markdown.deserialize(initialMarkdown),
  });

  const serializeToMarkdown = useCallback((): string => {
    try {
      return editor.getApi(MarkdownPlugin).markdown.serialize({ value: editor.children as Value });
    } catch {
      return "";
    }
  }, [editor]);

  const getMarkdownBlockStarts = useCallback((): { md: string; starts: number[] } => {
    const children = editor.children as Value;
    const md = editor.getApi(MarkdownPlugin).markdown.serialize({ value: children });
    const hit = mdBlockStartsCacheRef.current;
    if (hit && hit.md === md) return hit;

    const n = children.length;
    const starts = new Array<number>(n + 1);
    starts[0] = 0;
    const api = editor.getApi(MarkdownPlugin);
    for (let i = 0; i < n; i++) {
      try {
        starts[i + 1] = api.markdown.serialize({
          value: children.slice(0, i + 1) as Value,
        }).length;
      } catch {
        starts[i + 1] = starts[i];
      }
    }
    const next = { md, starts };
    mdBlockStartsCacheRef.current = next;
    return next;
  }, [editor]);

  const resolveSectionBlockRange = useCallback(
    (blockIndex: number): [number, number] => {
      try {
        const children = editor.children as Value;
        const { md, starts } = getMarkdownBlockStarts();
        const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
        boldHintsRef.current = hints;
        const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
        const nBlocks = children.length;
        const idx = Math.min(Math.max(0, blockIndex), Math.max(0, nBlocks - 1));
        const blockStartOffset = nBlocks === 0 ? 0 : starts[idx] ?? 0;
        const node = children[idx] as { type?: string };
        const headingText =
          headingLevelFromType(node?.type) > 0 ? editor.api.string(node as any) : "";
        const sec = getSectionForEditorBlock(docSections, blockStartOffset, node, headingText);
        if (sec) {
          const span = topLevelBlocksIntersectingMarkdownRange(starts, sec.from, sec.to);
          if (span) {
            return trimBlockSpanToSection(
              span[0], span[1],
              children as Array<{ type?: string }>,
              starts, sec, docSections,
            );
          }
        }
      } catch {
        /* fall through */
      }
      return getSectionBlockIndexRangeForTopLevelIndex(
        editor.children as Array<{ type?: string }>,
        blockIndex,
      );
    },
    [editor, getMarkdownBlockStarts],
  );

  const syncOutlineSections = useCallback(() => {
    try {
      const children = editor.children as Value;
      const { md, starts } = getMarkdownBlockStarts();
      const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
      boldHintsRef.current = hints;
      onOutlineSectionsChange?.(getSectionsFromTextWithBoldBlockHints(md, hints));
    } catch {
      /* ignore */
    }
  }, [editor, getMarkdownBlockStarts, onOutlineSectionsChange]);

  const syncOutlineSectionsRef = useRef(syncOutlineSections);
  syncOutlineSectionsRef.current = syncOutlineSections;

  useLayoutEffect(() => {
    queueMicrotask(() => {
      try {
        syncOutlineSectionsRef.current();
      } catch {
        /* ignore */
      }
    });
  }, [outlineBootGeneration]);

  const layoutRegionForBlockRange = useCallback(
    (b0: number, b1: number, pad: number): { top: number; left: number; width: number; height: number } | null => {
      const pageEl = pageRef.current;
      if (!pageEl) return null;
      const pr = pageEl.getBoundingClientRect();
      let top: number | null = null;
      let bottom: number | null = null;
      let left: number | null = null;
      let right: number | null = null;
      const children = editor.children as Value;
      for (let i = b0; i <= b1 && i < children.length; i++) {
        const node = children[i];
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
      if (top === null || bottom === null || left === null || right === null) return null;
      return {
        top: top - pad,
        left: left - pad,
        width: Math.max(12, right - left + pad * 2),
        height: Math.max(12, bottom - top + pad * 2),
      };
    },
    [editor],
  );

  useLayoutEffect(() => {
    if (activeSectionMarkdownFrom == null) {
      setPinnedRegion(null);
      setPinnedSectionBlocks(null);
      return;
    }
    try {
      const children = editor.children as Value;
      const { md, starts } = getMarkdownBlockStarts();
      const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
      const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
      const sec =
        docSections.find((s) => s.level > 0 && s.from === activeSectionMarkdownFrom) ??
        getSectionAtPos(docSections, activeSectionMarkdownFrom);
      if (!sec || sec.level <= 0) {
        setPinnedRegion(null);
        setPinnedSectionBlocks(null);
        return;
      }
      const span = topLevelBlocksIntersectingMarkdownRange(starts, sec.from, sec.to);
      if (!span) {
        setPinnedRegion(null);
        setPinnedSectionBlocks(null);
        return;
      }
      const [b0, b1] = trimBlockSpanToSection(
        span[0], span[1],
        children as Array<{ type?: string }>,
        starts, sec, docSections,
      );
      setPinnedSectionBlocks({ b0, b1 });
      setPinnedRegion(layoutRegionForBlockRange(b0, b1, 6));
    } catch {
      setPinnedRegion(null);
      setPinnedSectionBlocks(null);
    }
  }, [
    activeSectionMarkdownFrom,
    editor.children,
    getMarkdownBlockStarts,
    layoutRegionForBlockRange,
  ]);

  useLayoutEffect(() => {
    if (!proposalInline) {
      setProposalLayout(null);
      return;
    }
    try {
      const { starts } = getMarkdownBlockStarts();
      const { sectionFrom, sectionTo } = proposalInline;
      // sectionFrom === -1 means whole document
      const from = sectionFrom === -1 ? 0 : sectionFrom;
      const to = sectionTo === -1 ? (starts[starts.length - 1] ?? 0) : sectionTo;
      if (to <= from) {
        setProposalLayout(null);
        return;
      }
      const span = topLevelBlocksIntersectingMarkdownRange(starts, from, to);
      if (!span) {
        setProposalLayout(null);
        return;
      }
      const [b0, b1] = span;
      const reg = layoutRegionForBlockRange(b0, b1, 4);
      setProposalLayout(reg);
    } catch {
      setProposalLayout(null);
    }
  }, [proposalInline, editor.children, getMarkdownBlockStarts, layoutRegionForBlockRange]);

  useEffect(() => {
    if (!proposalInline || proposalInline.state !== "pending" || !proposalInline.messageId) return;
    const mid = proposalInline.messageId;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.shiftKey) return;
      if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        onProposalAccept?.(mid);
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        onProposalRevert?.(mid);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [proposalInline, onProposalAccept, onProposalRevert]);

  useImperativeHandle(
    ref,
    () => ({
      getEditor: () => editor,
      setMarkdown: (md: string) => {
        const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(md);
        editor.tf.reset();
        editor.tf.setValue(nodes);
        queueMicrotask(() => {
          try {
            syncOutlineSections();
          } catch {
            /* ignore */
          }
        });
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
      getCursorMarkdownSection: (): { from: number; title: string } | null => {
        const sel = editor.selection;
        if (!sel) return null;
        const block = editor.api.block({ at: sel, highest: true });
        if (!block) return null;
        const blockIndex = block[1][0]!;
        try {
          const children = editor.children as Value;
          const { md, starts } = getMarkdownBlockStarts();
          const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
          boldHintsRef.current = hints;
          const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
          const nBlocks = (editor.children as Value).length;
          const idx = Math.min(Math.max(0, blockIndex), Math.max(0, nBlocks - 1));
          const blockStartOffset = nBlocks === 0 ? 0 : starts[idx] ?? 0;
          const node = children[idx] as { type?: string };
          const headingText =
            headingLevelFromType(node?.type) > 0 ? editor.api.string(node as any) : "";
          const sec = getSectionForEditorBlock(docSections, blockStartOffset, node, headingText);
          if (!sec || sec.level <= 0) return null;
          return { from: sec.from, title: sec.title };
        } catch {
          return null;
        }
      },
      focusSectionAtMarkdownFrom: (markdownFrom: number) => {
        try {
          const children = editor.children as Value;
          const { md, starts } = getMarkdownBlockStarts();
          const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
          boldHintsRef.current = hints;
          const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
          const sec =
            docSections.find((s) => s.level > 0 && s.from === markdownFrom) ??
            getSectionAtPos(docSections, markdownFrom);
          if (!sec) return;
          const blocksSpan = topLevelBlocksIntersectingMarkdownRange(starts, sec.from, sec.to);
          if (!blocksSpan) return;
          const [b0] = trimBlockSpanToSection(
            blocksSpan[0],
            blocksSpan[1],
            children as Array<{ type?: string }>,
            starts,
            sec,
            docSections,
          );
          const startPoint = editor.api.start([b0]);
          if (!startPoint) return;
          editor.tf.select({ anchor: startPoint, focus: startPoint });
          editor.tf.focus();
          const node = children[b0];
          const dom = editor.api.toDOMNode(node as any);
          dom?.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          /* ignore */
        }
      },
      syncOutlineSections: () => {
        syncOutlineSections();
      },
    }),
    [editor, getMarkdownBlockStarts, serializeToMarkdown, syncOutlineSections],
  );

  const handleChange = useCallback(
    ({ value }: { value: Value }) => {
      if (!readyFired.current) {
        readyFired.current = true;
        onReady?.();
      }
      try {
        const md = editor.getApi(MarkdownPlugin).markdown.serialize({ value });
        onMarkdownChange(md);
        syncOutlineSections();
      } catch {
        // serialization may fail transiently during rapid edits
      }
    },
    [editor, onMarkdownChange, onReady, syncOutlineSections],
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
      if (!sectionHoverHighlight) return;
      if (contextMenuOpen) return;
      // Avoid setState while the user is holding a mouse button (text selection drag).
      // Re-rendering the editor chrome during selection fights the browser/Slate and can
      // collapse or snap the selection when crossing section bounds or leaving the scroll area.
      if (e.buttons !== 0) return;
      if (hoverRaf.current != null) return;
      hoverRaf.current = requestAnimationFrame(() => {
        hoverRaf.current = null;
        if (editorPointerDownRef.current) return;
        const pageEl = pageRef.current;
        if (!pageEl) {
          setHoverRegion(null);
          setHoverSectionBlocks(null);
          return;
        }

        const pr = pageEl.getBoundingClientRect();
        const x = e.clientX - pr.left;
        const y = e.clientY - pr.top;
        const hr = hoverRegionRef.current;
        const hbPrev = hoverSectionBlocksRef.current;
        const m = SECTION_HOVER_OUTSIDE_PX;
        const inStickyChrome =
          !!hr &&
          !!hbPrev &&
          x >= hr.left - m &&
          x <= hr.left + hr.width + m &&
          y >= hr.top - m &&
          y <= hr.top + hr.height + m;

        // While the pointer is within the sticky chrome zone (the highlight border + button),
        // freeze the current region — prevent both clearing and shifting to a neighbouring section.
        if (inStickyChrome) return;

        const range = editor.api.findEventRange(e.nativeEvent);
        if (!range) {
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
        const [b0, b1] = resolveSectionBlockRange(blockIndex);
        const layout = layoutRegionForBlockRange(b0, b1, 6);
        if (!layout) {
          setHoverRegion(null);
          setHoverSectionBlocks(null);
          return;
        }
        setHoverSectionBlocks({ b0, b1 });
        setHoverRegion(layout);
      });
    },
    [
      contextMenuOpen,
      editor,
      layoutRegionForBlockRange,
      resolveSectionBlockRange,
      sectionHoverHighlight,
    ],
  );

  useEffect(() => {
    if (!sectionHoverHighlight) {
      setHoverRegion(null);
      setHoverSectionBlocks(null);
    }
  }, [sectionHoverHighlight]);

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
        return;
      }
      if ((e.code === "BracketLeft" || e.code === "BracketRight") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        bumpEditorFontSize(editor, e.code === "BracketRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

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
    const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(text);
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
    const [b0, b1] = resolveSectionBlockRange(blockIndex);
    return liveSectionFromBlockRange(b0, b1);
  }, [editor, liveSectionFromBlockRange, resolveSectionBlockRange]);

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
    if (!sectionHoverHighlight) return;
    const showHover =
      mouseInEditorChrome && hoverSectionBlocks !== null;
    const hb = showHover ? hoverSectionBlocks : pinnedSectionBlocks;
    if (!hb) return;
    const sec = liveSectionFromBlockRange(hb.b0, hb.b1);
    if (!sec) return;
    onAddSectionToAgent(sectionToRef(sec));
  }, [
    hoverSectionBlocks,
    liveSectionFromBlockRange,
    mouseInEditorChrome,
    onAddSectionToAgent,
    pinnedSectionBlocks,
    sectionHoverHighlight,
  ]);

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
            onMouseEnter={() => setMouseInEditorChrome(true)}
            onMouseMove={updateHoverRegion}
            onMouseLeave={(e) => {
              if (e.buttons !== 0 || editorPointerDownRef.current) return;
              setMouseInEditorChrome(false);
              clearHoverRegion();
            }}
            onContextMenu={(e) => {
              lastContextNativeEventRef.current = e.nativeEvent;
            }}
          >
            <Box
              ref={pageRef}
              position="relative"
              overflow="visible"
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
              {proposalInline && proposalLayout ? (
                <>
                  <Box
                    position="absolute"
                    left={`${proposalLayout.left - 5}px`}
                    top={`${proposalLayout.top}px`}
                    w="3px"
                    h={`${proposalLayout.height}px`}
                    bg="green.500"
                    borderRadius="sm"
                    pointerEvents="none"
                    zIndex={4}
                  />
                  <Box
                    position="absolute"
                    top={`${proposalLayout.top}px`}
                    left={`${proposalLayout.left}px`}
                    w={`${proposalLayout.width}px`}
                    h={`${proposalLayout.height}px`}
                    borderRadius="md"
                    borderWidth="1px"
                    borderColor="rgba(34, 197, 94, 0.45)"
                    bg="rgba(34, 197, 94, 0.12)"
                    pointerEvents="none"
                    zIndex={3}
                  />
                  <Flex
                    position="absolute"
                    top={`${proposalLayout.top + proposalLayout.height + 8}px`}
                    left={`${proposalLayout.left}px`}
                    zIndex={5}
                    align="center"
                    gap={0}
                    borderRadius="md"
                    overflow="hidden"
                    borderWidth="1px"
                    borderColor="rgba(255,255,255,0.12)"
                    bg="#2c2c30"
                    boxShadow="0 4px 24px rgba(0,0,0,0.35)"
                    pointerEvents="auto"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {proposalInline.state === "streaming" ? (
                      <HStack px={3} py={2} gap={2}>
                        <Spinner size="sm" color="blue.300" />
                        <Text fontSize="xs" color="whiteAlpha.900">
                          Receiving…
                        </Text>
                        <Text fontSize="xs" color="whiteAlpha.600" truncate maxW="180px" title={proposalInline.sectionTitle}>
                          {proposalInline.sectionTitle}
                        </Text>
                      </HStack>
                    ) : proposalInline.messageId ? (
                      <>
                        <Button
                          size="xs"
                          h="30px"
                          px={3}
                          variant="ghost"
                          color="whiteAlpha.900"
                          borderRadius="0"
                          _hover={{ bg: "whiteAlpha.100" }}
                          onClick={() => onProposalRevert?.(proposalInline.messageId!)}
                        >
                          <HStack gap={2}>
                            <Text fontSize="sm">
                              Undo
                            </Text>
                            <Text fontSize="2xs" color="whiteAlpha.500">
                              {modShiftShortcut("R")}
                            </Text>
                          </HStack>
                        </Button>
                        <Box w="1px" alignSelf="stretch" bg="whiteAlpha.200" my={1} flexShrink={0} />
                        <Button
                          size="xs"
                          h="30px"
                          px={3}
                          borderRadius="0"
                          bg="green.600"
                          color="white"
                          _hover={{ bg: "green.500" }}
                          onClick={() => onProposalAccept?.(proposalInline.messageId!)}
                        >
                          <HStack gap={2}>
                            <Text fontSize="sm" fontWeight="semibold">
                              Keep
                            </Text>
                            <Text fontSize="2xs" color="whiteAlpha.800">
                              {modShiftShortcut("Y")}
                            </Text>
                          </HStack>
                        </Button>
                      </>
                    ) : null}
                  </Flex>
                </>
              ) : null}
              {(() => {
                const showHoverOutline =
                  sectionHoverHighlight && mouseInEditorChrome && hoverRegion !== null;
                const hoverMatchesPinned =
                  hoverSectionBlocks !== null &&
                  pinnedSectionBlocks !== null &&
                  hoverSectionBlocks.b0 === pinnedSectionBlocks.b0 &&
                  hoverSectionBlocks.b1 === pinnedSectionBlocks.b1;

                // Pinned (outline-selected) box — same toggle as hover; off hides both.
                const showPinned =
                  pinnedRegion != null && sectionHoverHighlight;
                // Hover box — shown when hovering a *different* section than the selected one.
                const showHover = showHoverOutline && !hoverMatchesPinned && hoverRegion != null;

                return (
                  <>
                    {showPinned && pinnedRegion && (
                      <Box
                        position="absolute"
                        top={`${pinnedRegion.top}px`}
                        left={`${pinnedRegion.left}px`}
                        w={`${pinnedRegion.width}px`}
                        h={`${pinnedRegion.height}px`}
                        borderWidth="1px"
                        borderStyle="solid"
                        borderColor="rgba(126, 58, 242, 0.65)"
                        borderRadius="lg"
                        bg="rgba(139, 92, 246, 0.07)"
                        pointerEvents="none"
                        zIndex={2}
                        overflow="visible"
                        boxSizing="border-box"
                      >
                        <IconButton
                          aria-label="Add section to agent chat"
                          size="xs"
                          variant="outline"
                          colorPalette="purple"
                          pointerEvents="auto"
                          position="absolute"
                          top="-22px"
                          right="-22px"
                          zIndex={1}
                          borderRadius="md"
                          minW="22px"
                          h="22px"
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            runAddHoveredSection();
                          }}
                        >
                          <Sparkles size={13} />
                        </IconButton>
                      </Box>
                    )}
                    {showHover && hoverRegion && (
                      <Box
                        position="absolute"
                        top={`${hoverRegion.top}px`}
                        left={`${hoverRegion.left}px`}
                        w={`${hoverRegion.width}px`}
                        h={`${hoverRegion.height}px`}
                        borderWidth="1px"
                        borderStyle="dashed"
                        borderColor="rgba(160, 160, 170, 0.35)"
                        borderRadius="lg"
                        bg="rgba(0, 0, 0, 0.025)"
                        pointerEvents="none"
                        zIndex={2}
                        overflow="visible"
                        boxSizing="border-box"
                      >
                        <IconButton
                          aria-label="Add section to agent chat"
                          size="xs"
                          variant="outline"
                          colorPalette="gray"
                          pointerEvents="auto"
                          position="absolute"
                          top="-22px"
                          right="-22px"
                          zIndex={1}
                          borderRadius="md"
                          minW="22px"
                          h="22px"
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            runAddHoveredSection();
                          }}
                        >
                          <Sparkles size={13} />
                        </IconButton>
                      </Box>
                    )}
                  </>
                );
              })()}
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
