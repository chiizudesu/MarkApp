import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Value } from "platejs";
import {
  Range as SlateRange,
  Transforms,
  type Editor as SlateEditor,
} from "slate";
import { MarkdownPlugin } from "@platejs/markdown";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { Menu, Portal, Box, IconButton, Flex, Text, HStack, Spinner, Button } from "@chakra-ui/react";
import { toaster } from "@/components/ui/toaster";
import { Plus, Sparkles } from "lucide-react";
import { modShiftShortcut } from "@/utils/platform";
import { insertImageFromFiles } from "@platejs/media";
import { editorPlugins } from "./platePlugins";
import { TableFloatingToolbar } from "./TableFloatingToolbar";
import { TextSelectionFloatingToolbar } from "./TextSelectionFloatingToolbar";
import { bumpEditorFontSize } from "@/utils/editorFontSize";
import {
  collectBoldOnlyParagraphHints,
  CONTEXT_SECTION_TITLE_MAX_CHARS,
  deriveContextSectionTitleFromMarkdown,
  findDocSectionForOutlineMarkdownFrom,
  getSectionBlockIndexRangeForTopLevelIndex,
  getSectionAtPos,
  getSectionForEditorBlock,
  getSectionsFromText,
  getSectionsFromTextWithBoldBlockHints,
  headingLevelFromType,
  topLevelBlocksIntersectingMarkdownRange,
  trimBlockSpanToSection,
  truncateContextSectionTitle,
  isManualSectionBreakBlock,
  manualSectionMarkerImmediatelyBeforeBlock,
  MARKAPP_MANUAL_SECTION_BLOCK_TYPE,
  type DocSection,
  type OutlineBoldBlockHint,
} from "@/services/sectionService";
import type { SectionRef } from "@/types/agent";
import {
  classifyClipboardRichness,
  htmlToPlainText,
  parsePasteDefaultRichHandling,
  readClipboardSnapshotAsync,
  snapshotFromDataTransfer,
  type ClipboardTextSnapshot,
} from "@/services/clipboardPaste";
import { htmlToGfmMarkdown } from "@/utils/htmlToGfmMarkdown";
import { PasteFormattingDialog, type PasteFormattingChoice } from "./PasteFormattingDialog";

/** Hit slop around the section band (~20px requested; ≥22 so the sparkle stays inside the zone). */
const SECTION_HOVER_OUTSIDE_PX = 22;

/** Thin connector between gutter dots. */
const SECTION_GUTTER_LINE_PX = 1;

/** Diameter of start / mid / end dots on the gutter mark. */
const SECTION_GUTTER_DOT_PX = 5;

/** Shift gutter bars further left into the margin (beyond the paragraph left edge). */
const SECTION_GUTTER_BAR_OFFSET_LEFT_PX = 18;

const SPARKLE_BTN_PX = 22;
/** Horizontal gap between sparkle button and the gutter header dot. */
const SPARKLE_LEFT_OF_DOT_GAP_PX = 6;

/**
 * Sparkle sits just left of the top gutter dot. `layoutRegion.left` is from
 * {@link layoutRegionForBlockRange} (same horizontal basis as gutter `lineLeft`).
 */
function sparkleIconLeftOfGutterDot(layoutRegionLeft: number): number {
  const lineLeft = layoutRegionLeft - SECTION_GUTTER_BAR_OFFSET_LEFT_PX;
  const cx = lineLeft + SECTION_GUTTER_LINE_PX / 2;
  const dotR = SECTION_GUTTER_DOT_PX / 2;
  return cx - dotR - SPARKLE_LEFT_OF_DOT_GAP_PX - SPARKLE_BTN_PX;
}

/** Nudge the control down so it lines up with the first line / gutter dot (layout box sits slightly above text). */
const SPARKLE_TOP_NUDGE_PX = 25;

/** Vertically center the sparkle on the header (top) gutter dot. */
function sparkleIconTopAlignedWithHeaderDot(layoutRegionTop: number): number {
  const headerDotCenterY = layoutRegionTop + 4;
  return headerDotCenterY - SPARKLE_BTN_PX / 2 + SPARKLE_TOP_NUDGE_PX;
}

/**
 * Sticky chrome = section layout band + sparkle hit target. The sparkle sits in the left margin
 * (see {@link sparkleIconLeftOfGutterDot}); without unioning its rect, the pointer leaves the band
 * before reaching the button and hover clears.
 */
function pointerInSectionStickyChrome(
  x: number,
  y: number,
  hr: { top: number; left: number; width: number; height: number },
  slopPx: number,
): boolean {
  const inBand =
    x >= hr.left - slopPx &&
    x <= hr.left + hr.width + slopPx &&
    y >= hr.top - slopPx &&
    y <= hr.top + hr.height + slopPx;
  const sl = sparkleIconLeftOfGutterDot(hr.left);
  const st = sparkleIconTopAlignedWithHeaderDot(hr.top);
  const inSparkle =
    x >= sl - slopPx &&
    x <= sl + SPARKLE_BTN_PX + slopPx &&
    y >= st - slopPx &&
    y <= st + SPARKLE_BTN_PX + slopPx;
  return inBand || inSparkle;
}

/** Horizontal line preview for “new section” spans block edges; extend past the right edge for affordance. */
const INTER_BLOCK_GAP_LINE_EXTEND_RIGHT_PX = 52;

/** Pointer slop for inter-block “new section” gap hover (sticky pass + vertical band + horizontal pick). */
const INTER_BLOCK_GAP_SLOP_X_PX = 14;
const INTER_BLOCK_GAP_SLOP_Y_PX = 28;
const INTER_BLOCK_GAP_PICK_MARGIN_X_PX = 56;
const INTER_BLOCK_GAP_VERTICAL_SLOP_MIN = 18;
const INTER_BLOCK_GAP_VERTICAL_SLOP_MAX = 32;
/** Added inside {@link INTER_BLOCK_GAP_VERTICAL_SLOP_MIN}/max clamp: half-gap + this. */
const INTER_BLOCK_GAP_VERTICAL_SLOP_PAD = 14;

/**
 * For indent lists, `toDOMNode` can be the `ul`/`ol` wrapper; its border box shifts vs paragraph `div`s,
 * which makes the gap line’s horizontal metrics jump. Measure left/right from the inner block (Plate row)
 * like we do for normal paragraphs; keep vertical math on the wrapper rects.
 */
function interBlockGapHorizMeasureRoot(root: HTMLElement): HTMLElement {
  const tag = root.tagName;
  if (tag === "UL" || tag === "OL") {
    const li = root.querySelector(":scope > li");
    const inner = li?.firstElementChild;
    if (inner instanceof HTMLElement) return inner;
    if (li instanceof HTMLElement) return li;
  }
  if (tag === "LI") {
    const inner = root.firstElementChild;
    if (inner instanceof HTMLElement) return inner;
  }
  return root;
}

/**
 * Left offset (relative to page rect `pr`) for gutter / pinned band alignment with body text.
 * {@link interBlockGapHorizMeasureRoot} avoids using the UL/OL margin box, which indents gutters right.
 */
function gutterContentLeftPx(dom: HTMLElement, pr: DOMRectReadOnly): number {
  return interBlockGapHorizMeasureRoot(dom).getBoundingClientRect().left - pr.left;
}

/** Inset gutter bars from the block’s top/bottom so they don’t visually touch adjacent lines. */
const SECTION_GUTTER_BAR_MARGIN_Y_PX = 20;

/** Shrink [rawTop, rawBottom) vertically by up to MARGIN_Y each side; keeps at least minHeight when space allows. */
function insetGutterBarVertically(
  rawTop: number,
  rawBottom: number,
  minHeight = 4,
): { top: number; height: number } {
  const inner = rawBottom - rawTop;
  if (inner <= minHeight) {
    const mid = (rawTop + rawBottom) / 2;
    return { top: mid - minHeight / 2, height: minHeight };
  }
  const marginEach = Math.min(SECTION_GUTTER_BAR_MARGIN_Y_PX, (inner - minHeight) / 2);
  return {
    top: rawTop + marginEach,
    height: inner - 2 * marginEach,
  };
}

const gutterAccentPalette: Record<
  "muted" | "hover" | "pinned" | "ai",
  { line: string; dot: string; shadow?: string }
> = {
  muted: {
    line: "rgba(124, 58, 237, 0.14)",
    dot: "rgba(124, 58, 237, 0.34)",
  },
  hover: {
    line: "rgba(124, 58, 237, 0.22)",
    dot: "rgba(124, 58, 237, 0.48)",
  },
  pinned: {
    line: "rgba(139, 92, 246, 0.4)",
    dot: "rgb(168, 85, 247)",
    shadow: "0 0 0 1px rgba(167, 139, 250, 0.65), 0 0 10px rgba(192, 181, 253, 0.35)",
  },
  ai: {
    line: "rgba(34, 197, 94, 0.55)",
    dot: "rgb(22, 163, 74)",
    shadow: "0 0 0 1px rgba(34, 197, 94, 0.45), 0 0 8px rgba(34, 197, 94, 0.22)",
  },
};

/**
 * Sparkle “add to agent” control: soft violet fill on hover only — no border/stroke change so the
 * outline matches the resting chrome (pinned vs hover palettes set the default border on each button).
 */
const SPARKLE_BTN_HOVER = {
  bg: "rgba(192, 181, 253, 0.32)",
  boxShadow: "none",
  "& svg": {
    color: "#a855f7",
  },
} as const;

function gutterAccentForBlock(
  blockIndex: number,
  hover: { b0: number; b1: number } | null,
  pinned: { b0: number; b1: number } | null,
): "muted" | "hover" | "pinned" {
  if (pinned && blockIndex >= pinned.b0 && blockIndex <= pinned.b1) return "pinned";
  if (hover && blockIndex >= hover.b0 && blockIndex <= hover.b1) return "hover";
  return "muted";
}

/** One outline block: dot → vertical line → dot (purple sections or green AI span). */
type SimpleGutterStrip = {
  key: string;
  accent: "muted" | "hover" | "pinned" | "ai";
  top: number;
  lineLeft: number;
  height: number;
};

function SimpleGutterStripView(props: { strip: SimpleGutterStrip; zIndex: number }) {
  const { strip, zIndex } = props;
  const pal = gutterAccentPalette[strip.accent];
  const dot = SECTION_GUTTER_DOT_PX;
  const lineW = SECTION_GUTTER_LINE_PX;
  const h = strip.height;
  const axisX = lineW / 2;
  const trackW = dot + lineW;

  if (h < dot + 6) {
    return (
      <Box
        position="absolute"
        left={`${strip.lineLeft + axisX}px`}
        top={`${strip.top}px`}
        w={`${dot}px`}
        h={`${h}px`}
        pointerEvents="none"
        zIndex={zIndex}
      >
        <Box
          position="absolute"
          left="50%"
          top="50%"
          transform="translate(-50%, -50%)"
          w={`${dot}px`}
          h={`${dot}px`}
          borderRadius="full"
          bg={pal.dot}
          boxShadow={pal.shadow}
        />
      </Box>
    );
  }

  const lineTop = dot;
  const lineH = Math.max(0, h - 2 * dot);

  return (
    <Box
      position="absolute"
      left={`${strip.lineLeft}px`}
      top={`${strip.top}px`}
      w={`${trackW}px`}
      h={`${h}px`}
      pointerEvents="none"
      zIndex={zIndex}
    >
      {lineH > 0 ? (
        <Box
          position="absolute"
          left={`${axisX}px`}
          top={`${lineTop}px`}
          transform="translateX(-50%)"
          w={`${lineW}px`}
          h={`${lineH}px`}
          bg={pal.line}
        />
      ) : null}
      <Box
        position="absolute"
        left={`${axisX}px`}
        top="0"
        transform="translate(-50%, 0)"
        w={`${dot}px`}
        h={`${dot}px`}
        borderRadius="full"
        bg={pal.dot}
        boxShadow={pal.shadow}
      />
      <Box
        position="absolute"
        left={`${axisX}px`}
        bottom="0"
        transform="translate(-50%, 0)"
        w={`${dot}px`}
        h={`${dot}px`}
        borderRadius="full"
        bg={pal.dot}
        boxShadow={pal.shadow}
      />
    </Box>
  );
}

function blockRangeIntersectsHoverPin(
  b0: number,
  b1: number,
  hoverBlocks: { b0: number; b1: number } | null,
  pinnedBlocks: { b0: number; b1: number } | null,
): boolean {
  const overlaps = (x0: number, x1: number, y0: number, y1: number) => x0 <= y1 && x1 >= y0;
  return (
    (!!hoverBlocks && overlaps(b0, b1, hoverBlocks.b0, hoverBlocks.b1)) ||
    (!!pinnedBlocks && overlaps(b0, b1, pinnedBlocks.b0, pinnedBlocks.b1))
  );
}

function blockRangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 <= b1 && b0 <= a1;
}

/** Same geometry as {@link buildDocumentSectionGutterMarks} for one block span — one continuous dot-line-dot. */
function layoutDotLineDotGutterStrip(params: {
  editor: { api: { toDOMNode: (n: unknown) => HTMLElement | null } };
  pr: DOMRectReadOnly;
  children: Value;
  b0: number;
  b1: number;
  key: string;
  accent: "ai";
}): SimpleGutterStrip | null {
  const { editor, pr, children, b0, b1, key, accent } = params;
  const blockPad = 6;
  let minLeft: number | null = null;
  let secTop: number | null = null;
  let secBottom: number | null = null;
  for (let i = b0; i <= b1 && i < children.length; i++) {
    const dom = editor.api.toDOMNode(children[i] as unknown);
    if (!dom || !(dom instanceof HTMLElement)) continue;
    const br = dom.getBoundingClientRect();
    const l = gutterContentLeftPx(dom, pr);
    if (minLeft === null || l < minLeft) minLeft = l;
    const t = br.top - pr.top;
    const b = br.bottom - pr.top;
    if (secTop === null || t < secTop) secTop = t;
    if (secBottom === null || b > secBottom) secBottom = b;
  }
  if (minLeft === null || secTop === null || secBottom === null) return null;
  const lineLeft = minLeft - blockPad - SECTION_GUTTER_BAR_OFFSET_LEFT_PX;
  const rawTop = secTop - blockPad;
  const rawBottom = secBottom + blockPad;
  const { top, height } = insetGutterBarVertically(rawTop, rawBottom, 6);
  return { key, accent, top, lineLeft, height };
}

function sectionStartInScrollViewport(
  editor: { api: { toDOMNode: (n: unknown) => HTMLElement | null } },
  scrollRoot: HTMLElement,
  marginPx: number,
  children: Value,
  b0: number,
): boolean {
  if (b0 < 0 || b0 >= children.length) return false;
  const dom = editor.api.toDOMNode(children[b0] as unknown);
  if (!dom) return true;
  const wr = scrollRoot.getBoundingClientRect();
  const br = dom.getBoundingClientRect();
  return !(br.bottom < wr.top - marginPx || br.top > wr.bottom + marginPx);
}

function buildDocumentSectionGutterMarks(params: {
  editor: { api: { toDOMNode: (n: unknown) => HTMLElement | null } };
  pr: DOMRectReadOnly;
  children: Value;
  starts: number[];
  docSections: DocSection[];
  hoverBlocks: { b0: number; b1: number } | null;
  pinnedBlocks: { b0: number; b1: number } | null;
  /** When set, skip sections whose start block lies far outside the scroll viewport. */
  scrollRoot: HTMLElement | null;
  viewportMarginPx: number;
  /** While AI green gutter covers this block span, omit purple section gutters there (no overlap). */
  aiReplaceBlockRange: { b0: number; b1: number } | null;
}): SimpleGutterStrip[] {
  const {
    editor,
    pr,
    children,
    starts,
    docSections,
    hoverBlocks,
    pinnedBlocks,
    scrollRoot,
    viewportMarginPx,
    aiReplaceBlockRange,
  } = params;
  const marks: SimpleGutterStrip[] = [];
  const blockPad = 6;
  const outlineSecs = docSections.filter((s) => s.level > 0);

  type SpanRec = { sec: DocSection; b0: number; b1: number };
  const spanRecs: SpanRec[] = [];
  for (const sec of outlineSecs) {
    const span = topLevelBlocksIntersectingMarkdownRange(starts, sec.from, sec.to);
    if (!span) continue;
    const [b0, b1] = trimBlockSpanToSection(
      span[0],
      span[1],
      children as Array<{ type?: string }>,
      starts,
      sec,
      docSections,
    );
    const forceShow =
      !scrollRoot ||
      blockRangeIntersectsHoverPin(b0, b1, hoverBlocks, pinnedBlocks) ||
      sectionStartInScrollViewport(editor, scrollRoot, viewportMarginPx, children, b0);
    if (!forceShow) continue;
    spanRecs.push({ sec, b0, b1 });
  }

  let minLeft: number | null = null;
  for (const { b0: tb0, b1: tb1 } of spanRecs) {
    for (let i = tb0; i <= tb1 && i < children.length; i++) {
      const dom = editor.api.toDOMNode(children[i] as unknown);
      if (!dom || !(dom instanceof HTMLElement)) continue;
      const l = gutterContentLeftPx(dom, pr);
      if (minLeft === null || l < minLeft) minLeft = l;
    }
  }
  if (minLeft === null) return [];

  const lineLeft = minLeft - blockPad - SECTION_GUTTER_BAR_OFFSET_LEFT_PX;

  for (const { sec, b0, b1 } of spanRecs) {

    let secTop: number | null = null;
    let secBottom: number | null = null;
    for (let i = b0; i <= b1 && i < children.length; i++) {
      const dom = editor.api.toDOMNode(children[i] as unknown);
      if (!dom) continue;
      const br = dom.getBoundingClientRect();
      const t = br.top - pr.top;
      const b = br.bottom - pr.top;
      if (secTop === null || t < secTop) secTop = t;
      if (secBottom === null || b > secBottom) secBottom = b;
    }
    if (secTop === null || secBottom === null) continue;

    let accent: "muted" | "hover" | "pinned" = "muted";
    for (let i = b0; i <= b1 && i < children.length; i++) {
      const a = gutterAccentForBlock(i, hoverBlocks, pinnedBlocks);
      if (a === "pinned") {
        accent = "pinned";
        break;
      }
      if (a === "hover") accent = "hover";
    }

    if (
      aiReplaceBlockRange &&
      blockRangesOverlap(b0, b1, aiReplaceBlockRange.b0, aiReplaceBlockRange.b1)
    ) {
      continue;
    }

    const rawTop = secTop - blockPad;
    const rawBottom = secBottom + blockPad;
    const { top, height } = insetGutterBarVertically(rawTop, rawBottom, 6);
    marks.push({ key: sec.id, accent, top, lineLeft, height });
  }

  return marks;
}

/** How long to wait after typing before syncing markdown to React app state (avoids whole-app re-renders per keystroke). */
const MARKDOWN_PARENT_DEBOUNCE_MS = 220;

/** Outline / `sections` in App can trail `doc` slightly — fewer outline parses while typing. */
const OUTLINE_SECTIONS_DEBOUNCE_MS = 480;

/**
 * Parsing block starts + section map for gutter / pinned band uses O(n) markdown prefix serialization.
 * Debounce when only document content changed so typing stays responsive; outline pick / hover still flush at 0ms.
 */
const EDITOR_LAYOUT_DEBOUNCE_MS = 100;

/** When culling gutter marks, keep this margin above/below the scroll viewport (px). */
const GUTTER_VIEWPORT_MARGIN_PX = 120;

/**
 * Fallback: exact prefix lengths via repeated serialize (O(n) growing prefixes).
 * Used when the fast pairwise block-boundary heuristic fails (lists / nested context).
 */
function computeMarkdownBlockStartsPrefixLoop(
  api: { markdown: { serialize: (o: { value: Value }) => string } },
  children: Value,
): number[] {
  const n = children.length;
  const starts = new Array<number>(n + 1);
  starts[0] = 0;
  for (let i = 0; i < n; i++) {
    try {
      starts[i + 1] = api.markdown.serialize({
        value: children.slice(0, i + 1) as Value,
      }).length;
    } catch {
      starts[i + 1] = starts[i]!;
    }
  }
  return starts;
}

/**
 * O(n) small serializes: cumulative markdown length per top-level block boundary matches
 * `serialize([prev, curr]) - serialize([prev])` when join rules depend only on adjacent blocks.
 * Validated against full `md` length and one midpoint prefix; falls back to the exact loop if not.
 */
function computeMarkdownBlockStartsForChildren(
  api: { markdown: { serialize: (o: { value: Value }) => string } },
  children: Value,
  md: string,
): number[] {
  const n = children.length;
  if (n === 0) {
    return [0];
  }
  try {
    const starts = new Array<number>(n + 1);
    starts[0] = 0;
    const firstLen = api.markdown.serialize({ value: [children[0]!] as Value }).length;
    starts[1] = firstLen;
    for (let i = 1; i < n; i++) {
      const pair = api.markdown.serialize({ value: [children[i - 1]!, children[i]!] as Value });
      const prevOne = api.markdown.serialize({ value: [children[i - 1]!] as Value });
      starts[i + 1] = starts[i]! + (pair.length - prevOne.length);
    }
    if (starts[n] !== md.length) {
      return computeMarkdownBlockStartsPrefixLoop(api, children);
    }
    const mid = Math.floor(n / 2);
    const checkLen = api.markdown.serialize({ value: children.slice(0, mid + 1) as Value }).length;
    if (checkLen !== starts[mid + 1]) {
      return computeMarkdownBlockStartsPrefixLoop(api, children);
    }
    return starts;
  } catch {
    return computeMarkdownBlockStartsPrefixLoop(api, children);
  }
}

export type PlateEditorHandle = {
  getEditor: () => ReturnType<typeof usePlateEditor> | null;
  setMarkdown: (md: string) => void;
  getMarkdown: () => string;
  scrollToHeading: (headingText: string) => void;
  /** Markdown offset of the outline section containing the caret (level > 0 only). */
  getCursorMarkdownSection: () => { from: number; title: string } | null;
  /** Move caret to the start of the section that begins at this markdown offset and scroll it into view. */
  focusSectionAtMarkdownFrom: (markdownFrom: number) => void;
  /** Scroll the block range covering [markdownFrom, markdownTo) into view (markdown offsets). */
  scrollMarkdownRangeIntoView: (markdownFrom: number, markdownTo: number) => void;
  /** Recompute outline sections (bold paragraphs + markdown) and notify App. */
  syncOutlineSections: () => void;
  /** Same section list as the outline sidebar (ATX + manual + bold-only implicit headings). */
  getOutlineDocSections: () => DocSection[];
  /** Apply any pending debounced markdown sync to the parent immediately (before save, etc.). */
  flushMarkdownToParent: () => void;
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

/** Distance from viewport Y to a closed vertical interval [top, bottom]. */
function distanceYToBlockSpan(clientY: number, top: number, bottom: number): number {
  if (clientY < top) return top - clientY;
  if (clientY > bottom) return clientY - bottom;
  return 0;
}

/**
 * Which top-level block row the sparkle click belongs to — by viewport Y only (sparkle sits in the margin,
 * so {@link editor.api.findEventRange} can hit the wrong block / sticky-hover can freeze the previous section).
 * Matches the outline’s notion of “section at this vertical position” better than frozen hover blocks.
 */
function topLevelBlockIndexAtClientY(
  editor: { api: { toDOMNode: (n: unknown) => HTMLElement | null } },
  children: Value,
  clientY: number,
): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < children.length; i++) {
    const dom = editor.api.toDOMNode(children[i] as unknown);
    if (!dom) continue;
    const br = dom.getBoundingClientRect();
    const d = distanceYToBlockSpan(clientY, br.top, br.bottom);
    if (d === 0) return i;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

type Props = {
  initialMarkdown: string;
  /** When true, only the outer “desk” around the page uses a dark tint; the page stays light. */
  isDark: boolean;
  onMarkdownChange: (md: string) => void;
  onReady?: () => void;
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
   * AI edit UI: toolbar (Receiving / Keep / Revert) and fallback green gutter when there is no
   * {@link lastAssistantMarkdownRange}. Green gutter is hidden while `state === "streaming"` once
   * {@link lastAssistantMarkdownRange} is used for pending applied edits.
   * sectionFrom/sectionTo are markdown offsets; -1 / -1 means whole document.
   */
  proposalInline?: {
    state: "streaming" | "pending";
    sectionTitle: string;
    messageId?: string;
    sectionFrom: number;
    sectionTo: number;
    oldText?: string;
    newText?: string;
  };
  /** After Keep / apply: show green gutter on the last changed markdown span until superseded. */
  lastAssistantMarkdownRange?: { from: number; to: number } | null;
  onProposalAccept?: (messageId: string) => void;
  onProposalRevert?: (messageId: string) => void;
};

function proposalInlinePropsEqual(
  a: Props["proposalInline"] | undefined,
  b: Props["proposalInline"] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state &&
    a.messageId === b.messageId &&
    a.sectionFrom === b.sectionFrom &&
    a.sectionTo === b.sectionTo &&
    a.sectionTitle === b.sectionTitle
  );
}

function arePlateEditorPropsEqual(prev: Props, next: Props): boolean {
  return (
    prev.initialMarkdown === next.initialMarkdown &&
    prev.isDark === next.isDark &&
    prev.onMarkdownChange === next.onMarkdownChange &&
    prev.onReady === next.onReady &&
    prev.onAddSectionToAgent === next.onAddSectionToAgent &&
    prev.onAddSelectionToAgent === next.onAddSelectionToAgent &&
    prev.sectionHoverHighlight === next.sectionHoverHighlight &&
    prev.activeSectionMarkdownFrom === next.activeSectionMarkdownFrom &&
    prev.onOutlineSectionsChange === next.onOutlineSectionsChange &&
    prev.outlineBootGeneration === next.outlineBootGeneration &&
    proposalInlinePropsEqual(prev.proposalInline, next.proposalInline) &&
    prev.lastAssistantMarkdownRange?.from === next.lastAssistantMarkdownRange?.from &&
    prev.lastAssistantMarkdownRange?.to === next.lastAssistantMarkdownRange?.to &&
    prev.onProposalAccept === next.onProposalAccept &&
    prev.onProposalRevert === next.onProposalRevert
  );
}

const PlateEditorInner = forwardRef<PlateEditorHandle, Props>(function PlateEditor(
  {
    initialMarkdown,
    isDark,
    onMarkdownChange,
    onReady,
    onAddSectionToAgent,
    onAddSelectionToAgent,
    sectionHoverHighlight = true,
    activeSectionMarkdownFrom = null,
    onOutlineSectionsChange,
    outlineBootGeneration = 0,
    proposalInline,
    lastAssistantMarkdownRange = null,
    onProposalAccept,
    onProposalRevert,
  },
  ref,
) {
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  onMarkdownChangeRef.current = onMarkdownChange;
  const onOutlineSectionsChangeRef = useRef(onOutlineSectionsChange);
  onOutlineSectionsChangeRef.current = onOutlineSectionsChange;

  const readyFired = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const lastContextNativeEventRef = useRef<globalThis.MouseEvent | null>(null);
  const hoverRaf = useRef<number | null>(null);
  const gapHoverRaf = useRef<number | null>(null);
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
  const [interBlockGapHover, setInterBlockGapHover] = useState<{
    afterBlock: number;
    midY: number;
    lineLeft: number;
    lineWidth: number;
  } | null>(null);
  const interBlockGapHoverRef = useRef(interBlockGapHover);
  const hoverRegionRef = useRef(hoverRegion);
  const hoverSectionBlocksRef = useRef(hoverSectionBlocks);
  /** Lazily rebuilt when serialized markdown changes — aligns block indices with getSectionsFromText. */
  const mdBlockStartsCacheRef = useRef<{ md: string; starts: number[] } | null>(null);
  const boldHintsRef = useRef<OutlineBoldBlockHint[]>([]);
  /** Browser timers are `number`; avoid `NodeJS.Timeout` from merged typings. */
  const parentSyncTimerRef = useRef<number | null>(null);
  const outlineSyncTimerRef = useRef<number | null>(null);
  const lastPinnedActiveFromRef = useRef<number | null | undefined>(undefined);
  const lastGutterHoverPinnedSigRef = useRef<string>("");
  useEffect(() => {
    hoverRegionRef.current = hoverRegion;
  }, [hoverRegion]);
  useEffect(() => {
    hoverSectionBlocksRef.current = hoverSectionBlocks;
  }, [hoverSectionBlocks]);
  useEffect(() => {
    interBlockGapHoverRef.current = interBlockGapHover;
  }, [interBlockGapHover]);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [pasteDialog, setPasteDialog] = useState<{ plain: string; html: string } | null>(null);
  const pasteDialogRef = useRef<{ plain: string; html: string } | null>(null);
  pasteDialogRef.current = pasteDialog;
  useEffect(() => {
    if (contextMenuOpen) setInterBlockGapHover(null);
  }, [contextMenuOpen]);
  const [editorZoom, setEditorZoom] = useState(1);
  const [proposalLayout, setProposalLayout] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    aiStrip: SimpleGutterStrip;
  } | null>(null);
  const [lastChangeAiGutterStrip, setLastChangeAiGutterStrip] = useState<SimpleGutterStrip | null>(null);
  /** Block span where AI gutter replaces section gutters (no double-draw). */
  const [aiReplaceBlockRange, setAiReplaceBlockRange] = useState<{ b0: number; b1: number } | null>(null);
  const [documentGutterMarks, setDocumentGutterMarks] = useState<SimpleGutterStrip[]>([]);

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

  /** Serialize `children` and compute per-block markdown start offsets (cached by full-doc markdown). */
  const getMarkdownBlockStartsFor = useCallback(
    (children: Value): { md: string; starts: number[] } => {
      const md = editor.getApi(MarkdownPlugin).markdown.serialize({ value: children });
      const hit = mdBlockStartsCacheRef.current;
      if (hit && hit.md === md) return hit;

      const api = editor.getApi(MarkdownPlugin);
      const starts = computeMarkdownBlockStartsForChildren(api, children, md);
      const next = { md, starts };
      mdBlockStartsCacheRef.current = next;
      return next;
    },
    [editor],
  );

  const getMarkdownBlockStarts = useCallback((): { md: string; starts: number[] } => {
    return getMarkdownBlockStartsFor(editor.children as Value);
  }, [editor, getMarkdownBlockStartsFor]);

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
      if (sectionHoverHighlight) {
        onOutlineSectionsChangeRef.current?.(getSectionsFromTextWithBoldBlockHints(md, hints));
      }
    } catch {
      /* ignore */
    }
  }, [editor, getMarkdownBlockStarts, sectionHoverHighlight]);

  const syncOutlineSectionsRef = useRef(syncOutlineSections);
  syncOutlineSectionsRef.current = syncOutlineSections;

  const flushMarkdownToParent = useCallback(() => {
    if (parentSyncTimerRef.current != null) {
      clearTimeout(parentSyncTimerRef.current);
      parentSyncTimerRef.current = null;
    }
    if (outlineSyncTimerRef.current != null) {
      clearTimeout(outlineSyncTimerRef.current);
      outlineSyncTimerRef.current = null;
    }
    try {
      const md = editor.getApi(MarkdownPlugin).markdown.serialize({ value: editor.children as Value });
      onMarkdownChangeRef.current(md);
      syncOutlineSectionsRef.current();
    } catch {
      /* noop */
    }
  }, [editor]);

  /**
   * Debounce markdown serialization + parent sync. Important: do not serialize on every `onValueChange`
   * — full-document markdown serialization is expensive and was blocking the input path each keystroke.
   * Outline sync uses a longer debounce so App `sections` churn less often while typing.
   */
  const scheduleParentMarkdownSync = useCallback(() => {
    if (parentSyncTimerRef.current != null) clearTimeout(parentSyncTimerRef.current);
    parentSyncTimerRef.current = window.setTimeout(() => {
      parentSyncTimerRef.current = null;
      try {
        const md = editor.getApi(MarkdownPlugin).markdown.serialize({ value: editor.children as Value });
        onMarkdownChangeRef.current(md);
      } catch {
        /* noop */
      }
    }, MARKDOWN_PARENT_DEBOUNCE_MS);

    if (outlineSyncTimerRef.current != null) clearTimeout(outlineSyncTimerRef.current);
    outlineSyncTimerRef.current = window.setTimeout(() => {
      outlineSyncTimerRef.current = null;
      try {
        syncOutlineSectionsRef.current();
      } catch {
        /* noop */
      }
    }, OUTLINE_SECTIONS_DEBOUNCE_MS);
  }, [editor]);

  useEffect(() => {
    return () => {
      if (parentSyncTimerRef.current != null) {
        clearTimeout(parentSyncTimerRef.current);
        parentSyncTimerRef.current = null;
      }
      if (outlineSyncTimerRef.current != null) {
        clearTimeout(outlineSyncTimerRef.current);
        outlineSyncTimerRef.current = null;
      }
      try {
        const md = editor.getApi(MarkdownPlugin).markdown.serialize({ value: editor.children as Value });
        onMarkdownChangeRef.current(md);
        syncOutlineSectionsRef.current();
      } catch {
        /* noop */
      }
    };
  }, [editor]);

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
        const l =
          dom instanceof HTMLElement ? gutterContentLeftPx(dom, pr) : br.left - pr.left;
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

  // Defer after paint; debounce when only the document changed so prefix serialization does not run every keystroke.
  useEffect(() => {
    if (activeSectionMarkdownFrom == null) {
      lastPinnedActiveFromRef.current = null;
      setPinnedRegion(null);
      setPinnedSectionBlocks(null);
      return;
    }
    const activeBumped = lastPinnedActiveFromRef.current !== activeSectionMarkdownFrom;
    lastPinnedActiveFromRef.current = activeSectionMarkdownFrom;
    const delay = activeBumped ? 0 : EDITOR_LAYOUT_DEBOUNCE_MS;
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
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
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
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
    if (proposalInline.state === "streaming") {
      setProposalLayout(null);
      setAiReplaceBlockRange(null);
      return;
    }
    if (proposalInline.state === "pending" && lastAssistantMarkdownRange) {
      setProposalLayout(null);
      return;
    }
    try {
      const children = editor.children as Value;
      const { md, starts } = getMarkdownBlockStarts();
      const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
      const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
      const { sectionFrom, sectionTo } = proposalInline;
      const from = sectionFrom === -1 ? 0 : sectionFrom;
      const to = sectionTo === -1 ? (starts[starts.length - 1] ?? 0) : sectionTo;
      if (to <= from) {
        setProposalLayout(null);
        setAiReplaceBlockRange(null);
        return;
      }
      const span = topLevelBlocksIntersectingMarkdownRange(starts, from, to);
      if (!span) {
        setProposalLayout(null);
        setAiReplaceBlockRange(null);
        return;
      }
      let [b0, b1] = span;
      const sec =
        docSections.find((s) => s.level > 0 && from >= s.from && from < s.to) ??
        docSections.find((s) => s.level > 0 && Math.abs(s.from - from) <= 8);
      if (sec) {
        [b0, b1] = trimBlockSpanToSection(
          b0,
          b1,
          children as Array<{ type?: string }>,
          starts,
          sec,
          docSections,
        );
      }
      const reg = layoutRegionForBlockRange(b0, b1, 4);
      if (!reg) {
        setProposalLayout(null);
        setAiReplaceBlockRange(null);
        return;
      }
      const pageEl = pageRef.current;
      if (!pageEl) {
        setProposalLayout(null);
        setAiReplaceBlockRange(null);
        return;
      }
      const pr = pageEl.getBoundingClientRect();
      const aiStrip = layoutDotLineDotGutterStrip({
        editor: editor as { api: { toDOMNode: (n: unknown) => HTMLElement | null } },
        pr,
        children,
        b0,
        b1,
        key: "proposal-ai-gutter",
        accent: "ai",
      });
      if (!aiStrip) {
        setProposalLayout(null);
        setAiReplaceBlockRange(null);
        return;
      }
      setProposalLayout({ ...reg, aiStrip });
      setAiReplaceBlockRange({ b0, b1 });
    } catch {
      setProposalLayout(null);
      setAiReplaceBlockRange(null);
    }
  }, [
    proposalInline,
    lastAssistantMarkdownRange,
    editor,
    editor.children,
    getMarkdownBlockStarts,
    layoutRegionForBlockRange,
  ]);

  useLayoutEffect(() => {
    if (!lastAssistantMarkdownRange) {
      setLastChangeAiGutterStrip(null);
      if (!proposalInline) setAiReplaceBlockRange(null);
      return;
    }
    if (proposalInline?.state === "streaming") {
      setLastChangeAiGutterStrip(null);
      return;
    }
    try {
      const { from, to } = lastAssistantMarkdownRange;
      if (to <= from) {
        setLastChangeAiGutterStrip(null);
        setAiReplaceBlockRange(null);
        return;
      }
      const children = editor.children as Value;
      const { md, starts } = getMarkdownBlockStarts();
      const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
      const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
      const span = topLevelBlocksIntersectingMarkdownRange(starts, from, to);
      if (!span) {
        setLastChangeAiGutterStrip(null);
        setAiReplaceBlockRange(null);
        return;
      }
      let [b0, b1] = span;
      const sec =
        docSections.find((s) => s.level > 0 && from >= s.from && from < s.to) ??
        docSections.find((s) => s.level > 0 && Math.abs(s.from - from) <= 8);
      if (sec) {
        [b0, b1] = trimBlockSpanToSection(
          b0,
          b1,
          children as Array<{ type?: string }>,
          starts,
          sec,
          docSections,
        );
      }
      const pageEl = pageRef.current;
      if (!pageEl) {
        setLastChangeAiGutterStrip(null);
        setAiReplaceBlockRange(null);
        return;
      }
      const pr = pageEl.getBoundingClientRect();
      const strip = layoutDotLineDotGutterStrip({
        editor: editor as { api: { toDOMNode: (n: unknown) => HTMLElement | null } },
        pr,
        children,
        b0,
        b1,
        key: "last-change-ai-gutter",
        accent: "ai",
      });
      if (!strip) {
        setLastChangeAiGutterStrip(null);
        setAiReplaceBlockRange(null);
        return;
      }
      setLastChangeAiGutterStrip(strip);
      setAiReplaceBlockRange({ b0, b1 });
    } catch {
      setLastChangeAiGutterStrip(null);
      setAiReplaceBlockRange(null);
    }
  }, [proposalInline, lastAssistantMarkdownRange, editor, editor.children, getMarkdownBlockStarts]);

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

  /** rAF + debounce: serializing all block prefixes for gutters is expensive; skip until typing pauses unless hover/pin changed. */
  useEffect(() => {
    if (!sectionHoverHighlight) {
      lastGutterHoverPinnedSigRef.current = "";
      setDocumentGutterMarks([]);
      return;
    }
    const sig = `${hoverSectionBlocks?.b0 ?? "—"}:${hoverSectionBlocks?.b1 ?? "—"}|${pinnedSectionBlocks?.b0 ?? "—"}:${pinnedSectionBlocks?.b1 ?? "—"}`;
    const hoverPinBumped = sig !== lastGutterHoverPinnedSigRef.current;
    lastGutterHoverPinnedSigRef.current = sig;
    const delay = hoverPinBumped ? 0 : EDITOR_LAYOUT_DEBOUNCE_MS;
    let cancelled = false;
    let rafId = 0;
    const timerId = window.setTimeout(() => {
      if (cancelled) return;
      rafId = requestAnimationFrame(() => {
        if (cancelled) return;
        const pageEl = pageRef.current;
        if (!pageEl) {
          setDocumentGutterMarks([]);
          return;
        }
        try {
          const children = editor.children as Value;
          const { md, starts } = getMarkdownBlockStarts();
          const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
          const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
          setDocumentGutterMarks(
            buildDocumentSectionGutterMarks({
              editor: editor as { api: { toDOMNode: (n: unknown) => HTMLElement | null } },
              pr: pageEl.getBoundingClientRect(),
              children,
              starts,
              docSections,
              hoverBlocks: hoverSectionBlocks,
              pinnedBlocks: pinnedSectionBlocks,
              scrollRoot: wrapRef.current,
              viewportMarginPx: GUTTER_VIEWPORT_MARGIN_PX,
              aiReplaceBlockRange,
            }),
          );
        } catch {
          setDocumentGutterMarks([]);
        }
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timerId);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [
    sectionHoverHighlight,
    editor,
    editor.children,
    getMarkdownBlockStarts,
    hoverSectionBlocks,
    pinnedSectionBlocks,
    aiReplaceBlockRange,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      getEditor: () => editor,
      setMarkdown: (md: string) => {
        if (parentSyncTimerRef.current != null) {
          clearTimeout(parentSyncTimerRef.current);
          parentSyncTimerRef.current = null;
        }
        if (outlineSyncTimerRef.current != null) {
          clearTimeout(outlineSyncTimerRef.current);
          outlineSyncTimerRef.current = null;
        }
        const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(md);
        editor.tf.reset();
        editor.tf.setValue(nodes);
        queueMicrotask(() => {
          try {
            onMarkdownChangeRef.current(md);
            syncOutlineSectionsRef.current();
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
      scrollMarkdownRangeIntoView: (markdownFrom: number, markdownTo: number) => {
        try {
          const children = editor.children as Value;
          const { md, starts } = getMarkdownBlockStarts();
          const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
          boldHintsRef.current = hints;
          const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
          const from = Math.max(0, markdownFrom);
          const to = Math.max(from, markdownTo);
          const span = topLevelBlocksIntersectingMarkdownRange(starts, from, to);
          if (!span) return;
          const sec =
            docSections.find((s) => s.level > 0 && from >= s.from && from < s.to) ??
            docSections.find((s) => s.level > 0 && Math.abs(s.from - from) <= 8);
          let [b0, b1] = span;
          if (sec) {
            [b0, b1] = trimBlockSpanToSection(
              b0,
              b1,
              children as Array<{ type?: string }>,
              starts,
              sec,
              docSections,
            );
          }
          const mid = Math.floor((b0 + b1) / 2);
          const node = children[mid];
          const dom = editor.api.toDOMNode(node as any);
          dom?.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          /* ignore */
        }
      },
      syncOutlineSections: () => {
        syncOutlineSections();
      },
      getOutlineDocSections: (): DocSection[] => {
        try {
          const children = editor.children as Value;
          const { md, starts } = getMarkdownBlockStarts();
          const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
          return getSectionsFromTextWithBoldBlockHints(md, hints);
        } catch {
          try {
            return getSectionsFromText(serializeToMarkdown());
          } catch {
            return [];
          }
        }
      },
      flushMarkdownToParent,
    }),
    [editor, flushMarkdownToParent, getMarkdownBlockStarts, serializeToMarkdown, syncOutlineSections],
  );

  const handleChange = useCallback(
    ({ value: _value }: { value: Value }) => {
      if (!readyFired.current) {
        readyFired.current = true;
        onReady?.();
      }
      scheduleParentMarkdownSync();
    },
    [onReady, scheduleParentMarkdownSync],
  );

  const liveSectionFromBlockRange = useCallback(
    (b0: number, b1: number): DocSection | null => {
      const children = editor.children as Value;
      if (b0 > b1 || b0 < 0 || b1 >= children.length) return null;
      const first = children[b0] as { type?: string };
      const hl = headingLevelFromType(first?.type);
      const headingText = hl > 0 ? editor.api.string(first as any).trim() : "";
      const frag = children.slice(b0, b1 + 1) as Value;
      let content: string;
      try {
        content = editor.getApi(MarkdownPlugin).markdown.serialize({ value: frag });
      } catch {
        return null;
      }

      let outlineSec: DocSection | null = null;
      try {
        const { md, starts } = getMarkdownBlockStarts();
        const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
        const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
        const blockStartOffset = starts[b0] ?? 0;
        outlineSec = getSectionForEditorBlock(docSections, blockStartOffset, first, headingText);
      } catch {
        outlineSec = null;
      }

      const maxLen = CONTEXT_SECTION_TITLE_MAX_CHARS;
      const derivedBodyTitle = () => deriveContextSectionTitleFromMarkdown(content, maxLen);

      if (outlineSec) {
        const isDocRoot =
          outlineSec.id === "doc-root" ||
          outlineSec.level === 0 ||
          outlineSec.title.replace(/\u200B|\uFEFF/g, "").trim() === "(Document)";
        const title = isDocRoot ? derivedBodyTitle() : truncateContextSectionTitle(outlineSec.title, maxLen);
        return {
          ...outlineSec,
          title,
          content,
        };
      }

      const title =
        headingText.length > 0
          ? truncateContextSectionTitle(headingText, maxLen)
          : derivedBodyTitle();
      return {
        id: `sec-live-${b0}`,
        title,
        level: hl,
        from: 0,
        to: 0,
        content,
      };
    },
    [editor, getMarkdownBlockStarts],
  );

  const updateInterBlockGapHover = useCallback(
    (e: React.MouseEvent) => {
      if (contextMenuOpen) return;
      if (e.buttons !== 0) return;
      if (gapHoverRaf.current != null) return;
      gapHoverRaf.current = requestAnimationFrame(() => {
        gapHoverRaf.current = null;
        if (editorPointerDownRef.current) {
          setInterBlockGapHover(null);
          return;
        }
        const pageEl = pageRef.current;
        if (!pageEl) {
          setInterBlockGapHover(null);
          return;
        }
        const pr = pageEl.getBoundingClientRect();
        const x = e.clientX - pr.left;
        const y = e.clientY - pr.top;

        const cur = interBlockGapHoverRef.current;
        if (cur) {
          if (
            x >= cur.lineLeft - INTER_BLOCK_GAP_SLOP_X_PX &&
            x <= cur.lineLeft + cur.lineWidth + INTER_BLOCK_GAP_SLOP_X_PX &&
            y >= cur.midY - INTER_BLOCK_GAP_SLOP_Y_PX &&
            y <= cur.midY + INTER_BLOCK_GAP_SLOP_Y_PX
          ) {
            return;
          }
        }

        try {
          const children = editor.children as Value;
          const n = children.length;
          if (n < 2) {
            setInterBlockGapHover(null);
            return;
          }
          let picked: {
            afterBlock: number;
            midY: number;
            lineLeft: number;
            lineWidth: number;
          } | null = null;
          for (let i = 0; i < n - 1; i++) {
            if (isManualSectionBreakBlock(children[i]) || isManualSectionBreakBlock(children[i + 1])) {
              continue;
            }
            const domLo = editor.api.toDOMNode(children[i] as any);
            const domHi = editor.api.toDOMNode(children[i + 1] as any);
            if (!domLo || !domHi) continue;
            const brLo = domLo.getBoundingClientRect();
            const brHi = domHi.getBoundingClientRect();
            const gapTop = brLo.bottom - pr.top;
            const gapBot = brHi.top - pr.top;
            const lo = Math.min(gapTop, gapBot);
            const hi = Math.max(gapTop, gapBot);
            const midY = (lo + hi) / 2;
            const gapH = hi - lo;
            const slop = Math.max(
              INTER_BLOCK_GAP_VERTICAL_SLOP_MIN,
              Math.min(INTER_BLOCK_GAP_VERTICAL_SLOP_MAX, gapH / 2 + INTER_BLOCK_GAP_VERTICAL_SLOP_PAD),
            );
            if (y < lo - slop || y > hi + slop) continue;
            const hitLeft = Math.min(brLo.left, brHi.left) - pr.left;
            const hitRight = Math.max(brLo.right, brHi.right) - pr.left;
            if (x < hitLeft - INTER_BLOCK_GAP_PICK_MARGIN_X_PX || x > hitRight + INTER_BLOCK_GAP_PICK_MARGIN_X_PX) {
              continue;
            }
            const hrLo = interBlockGapHorizMeasureRoot(domLo).getBoundingClientRect();
            const hrHi = interBlockGapHorizMeasureRoot(domHi).getBoundingClientRect();
            const left = Math.min(hrLo.left, hrHi.left) - pr.left;
            const right = Math.max(hrLo.right, hrHi.right) - pr.left;
            const { md, starts } = getMarkdownBlockStarts();
            if (manualSectionMarkerImmediatelyBeforeBlock(md, starts, i + 1)) continue;
            picked = {
              afterBlock: i,
              midY,
              lineLeft: left,
              lineWidth: Math.max(48, right - left) + INTER_BLOCK_GAP_LINE_EXTEND_RIGHT_PX,
            };
            break;
          }
          setInterBlockGapHover(picked);
        } catch {
          setInterBlockGapHover(null);
        }
      });
    },
    [contextMenuOpen, editor, getMarkdownBlockStarts],
  );

  const insertManualSectionAfterBlock = useCallback(
    (afterBlockIndex: number) => {
      try {
        const children = editor.children as Value;
        const n = children.length;
        if (afterBlockIndex < 0 || afterBlockIndex >= n - 1) return;
        if (
          isManualSectionBreakBlock(children[afterBlockIndex]) ||
          isManualSectionBreakBlock(children[afterBlockIndex + 1])
        ) {
          return;
        }
        editor.tf.insertNodes(
          { type: MARKAPP_MANUAL_SECTION_BLOCK_TYPE, children: [{ text: "" }] },
          { at: [afterBlockIndex + 1] },
        );
        setInterBlockGapHover(null);
      } catch {
        /* ignore */
      }
    },
    [editor],
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
        const inStickyChrome = !!hr && !!hbPrev && pointerInSectionStickyChrome(x, y, hr, m);

        // While the pointer is within the sticky chrome zone (section band + sparkle button),
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
    if (gapHoverRaf.current != null) cancelAnimationFrame(gapHoverRaf.current);
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

  const getSelectionMarkdownSpan = useCallback((): { text: string; from: number; to: number } | null => {
    const sel = editor.selection;
    if (!sel || SlateRange.isCollapsed(sel)) return null;
    const fragment = editor.api.getFragment(sel);
    if (!fragment?.length) return null;
    let fragMd: string;
    try {
      fragMd = editor.getApi(MarkdownPlugin).markdown.serialize({ value: fragment as Value });
    } catch {
      return null;
    }
    if (!fragMd.length) return null;
    const fullMd = serializeToMarkdown();
    const matches: number[] = [];
    let pos = 0;
    while (true) {
      const i = fullMd.indexOf(fragMd, pos);
      if (i < 0) break;
      matches.push(i);
      pos = i + 1;
    }
    if (matches.length === 0) return null;
    let from: number;
    if (matches.length === 1) {
      from = matches[0]!;
    } else {
      const anchor = SlateRange.isForward(sel) ? sel.anchor : sel.focus;
      const block = editor.api.block({ at: anchor, highest: true });
      if (!block) {
        from = matches[0]!;
      } else {
        const blockIndex = block[1][0]!;
        const { starts } = getMarkdownBlockStarts();
        const blockStart = starts[blockIndex] ?? 0;
        from = matches[0]!;
        let bestDist = Math.abs(matches[0]! - blockStart);
        for (const m of matches) {
          const d = Math.abs(m - blockStart);
          if (d < bestDist) {
            bestDist = d;
            from = m;
          }
        }
      }
    }
    return { text: fragMd, from, to: from + fragMd.length };
  }, [editor, getMarkdownBlockStarts, serializeToMarkdown]);

  const insertDeserializedMarkdown = useCallback(
    (text: string) => {
      if (!text) return;
      try {
        const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(text);
        editor.tf.insertFragment(nodes);
      } catch {
        Transforms.insertText(editor as unknown as SlateEditor, text);
      }
    },
    [editor],
  );

  const applyPasteSnapshotPlain = useCallback(
    (snapshot: ClipboardTextSnapshot) => {
      const plain = snapshot.plain.trim()
        ? snapshot.plain
        : htmlToPlainText(snapshot.html ?? "");
      if (plain) insertDeserializedMarkdown(plain);
    },
    [insertDeserializedMarkdown],
  );

  const runRichPasteWithPolicy = useCallback(
    async (snapshot: ClipboardTextSnapshot) => {
      const api = window.markAPI;
      const raw = api ? await api.getStore("pasteDefaultRichHandling") : undefined;
      const policy = parsePasteDefaultRichHandling(raw);
      if (policy === "ask") {
        setPasteDialog({
          plain: snapshot.plain,
          html: snapshot.html ?? "",
        });
        return;
      }
      if (policy === "plain") {
        applyPasteSnapshotPlain(snapshot);
        return;
      }
      const conv = htmlToGfmMarkdown(snapshot.html ?? "", snapshot.plain);
      if (!conv.ok) {
        toaster.create({
          type: "info",
          title: "Formatting not converted",
          description: conv.reason,
        });
      }
      insertDeserializedMarkdown(conv.markdown);
    },
    [applyPasteSnapshotPlain, insertDeserializedMarkdown],
  );

  const processClipboardSnapshot = useCallback(
    (snapshot: ClipboardTextSnapshot) => {
      const classification = classifyClipboardRichness(snapshot);
      if (classification === "oversized") {
        toaster.create({
          type: "warning",
          title: "Clipboard too large",
          description: "HTML was too large; pasted as plain text only.",
        });
        applyPasteSnapshotPlain(snapshot);
        return;
      }
      if (classification === "plain") {
        applyPasteSnapshotPlain(snapshot);
        return;
      }
      void runRichPasteWithPolicy(snapshot);
    },
    [applyPasteSnapshotPlain, runRichPasteWithPolicy],
  );

  const handlePasteFormatChoose = useCallback(
    (choice: PasteFormattingChoice, remember: boolean) => {
      const snap = pasteDialogRef.current;
      setPasteDialog(null);
      if (!snap) return;
      void (async () => {
        if (remember && window.markAPI) {
          await window.markAPI.setStore(
            "pasteDefaultRichHandling",
            choice === "markdown" ? "markdown" : "plain",
          );
        }
        if (choice === "plain") {
          const plain = snap.plain.trim() ? snap.plain : htmlToPlainText(snap.html);
          insertDeserializedMarkdown(plain);
        } else {
          const conv = htmlToGfmMarkdown(snap.html, snap.plain);
          if (!conv.ok) {
            toaster.create({
              type: "info",
              title: "Formatting not converted",
              description: conv.reason,
            });
          }
          insertDeserializedMarkdown(conv.markdown);
        }
      })();
    },
    [insertDeserializedMarkdown],
  );

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
    const snapshot = await readClipboardSnapshotAsync();
    if (!snapshot.plain.trim() && !snapshot.html?.trim()) return;
    processClipboardSnapshot(snapshot);
  }, [editor, processClipboardSnapshot]);

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

  /** Section for the current selection/caret — preferred over context-menu coordinates when they disagree. */
  const docSectionFromCaretsSelection = useCallback((): DocSection | null => {
    const sel = editor.selection;
    if (!sel) return null;
    const block = editor.api.block({ at: sel, highest: true });
    if (!block) return null;
    const blockIndex = block[1][0]!;
    const [b0, b1] = resolveSectionBlockRange(blockIndex);
    return liveSectionFromBlockRange(b0, b1);
  }, [editor, liveSectionFromBlockRange, resolveSectionBlockRange]);

  const runAddSection = useCallback(() => {
    const fromCtx = sectionAtContext();
    const fromCaret = docSectionFromCaretsSelection();
    let sec: DocSection | null = null;
    if (fromCaret && fromCtx && fromCaret.id !== fromCtx.id) sec = fromCaret;
    else sec = fromCtx ?? fromCaret;
    if (!sec) return;
    onAddSectionToAgent(sectionToRef(sec));
  }, [docSectionFromCaretsSelection, onAddSectionToAgent, sectionAtContext]);

  const runAddSelection = useCallback(() => {
    const span = getSelectionMarkdownSpan();
    if (!span?.text.trim()) return;
    onAddSelectionToAgent({
      id: `sel-${Date.now()}`,
      title: "(Selection)",
      content: span.text,
      from: span.from,
      to: span.to,
    });
  }, [getSelectionMarkdownSpan, onAddSelectionToAgent]);

  /** Same section identity as outline rows: {@link findDocSectionForOutlineMarkdownFrom} on block start offset. */
  const sectionRefAlignedToOutline = useCallback(
    (b0: number): SectionRef | null => {
      try {
        const children = editor.children as Value;
        const { md, starts } = getMarkdownBlockStarts();
        const hints = collectBoldOnlyParagraphHints(children as unknown[], starts);
        const docSections = getSectionsFromTextWithBoldBlockHints(md, hints);
        const anchor = starts[b0] ?? 0;
        const sec = findDocSectionForOutlineMarkdownFrom(docSections, anchor);
        if (!sec || sec.level <= 0) return null;
        return sectionToRef(sec);
      } catch {
        return null;
      }
    },
    [editor, getMarkdownBlockStarts],
  );

  const runAddHoveredSection = useCallback(
    (e: ReactMouseEvent) => {
      if (!sectionHoverHighlight) return;
      const children = editor.children as Value;
      const blockIdx = topLevelBlockIndexAtClientY(
        editor as { api: { toDOMNode: (n: unknown) => HTMLElement | null } },
        children,
        e.clientY,
      );
      const [b0, b1] = resolveSectionBlockRange(blockIdx);
      const aligned = sectionRefAlignedToOutline(b0);
      if (aligned) {
        onAddSectionToAgent(aligned);
        return;
      }
      const sec = liveSectionFromBlockRange(b0, b1);
      if (!sec) return;
      onAddSectionToAgent(sectionToRef(sec));
    },
    [
      sectionHoverHighlight,
      editor,
      resolveSectionBlockRange,
      sectionRefAlignedToOutline,
      liveSectionFromBlockRange,
      onAddSectionToAgent,
    ],
  );

  const handleEditorPaste = useCallback(
    (e: ClipboardEvent) => {
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
      if (imageFiles.length > 0) {
        e.preventDefault();
        const xfer = new DataTransfer();
        for (const f of imageFiles) xfer.items.add(f);
        insertImageFromFiles(editor, xfer.files);
        return;
      }
      const snapshot = snapshotFromDataTransfer(dt);
      if (!snapshot.plain.trim() && !snapshot.html?.trim()) return;
      e.preventDefault();
      processClipboardSnapshot(snapshot);
    },
    [editor, processClipboardSnapshot],
  );

  return (
    <>
      <PasteFormattingDialog
        open={pasteDialog !== null}
        onChoose={handlePasteFormatChoose}
        onCancel={() => setPasteDialog(null)}
      />
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
            onMouseMove={(ev) => {
              updateInterBlockGapHover(ev);
              updateHoverRegion(ev);
            }}
            onMouseLeave={(e) => {
              if (e.buttons !== 0 || editorPointerDownRef.current) return;
              setMouseInEditorChrome(false);
              clearHoverRegion();
              setInterBlockGapHover(null);
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
                <SimpleGutterStripView strip={proposalLayout.aiStrip} zIndex={4} />
              ) : null}
              {lastChangeAiGutterStrip &&
              (!proposalInline || proposalInline.state === "pending") ? (
                <SimpleGutterStripView
                  strip={lastChangeAiGutterStrip}
                  zIndex={proposalInline?.state === "pending" ? 4 : 3}
                />
              ) : null}
              {proposalInline && (proposalInline.state === "streaming" || proposalInline.messageId) ? (
                <Flex
                  position="sticky"
                  top={{ base: "10px", md: "14px" }}
                  zIndex={5}
                  w="fit-content"
                  maxW="100%"
                  ml="auto"
                  mr={{ base: "14px", md: "20px" }}
                  flexShrink={0}
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
                            Revert
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
                            Keep changes
                          </Text>
                          <Text fontSize="2xs" color="whiteAlpha.800">
                            {modShiftShortcut("Y")}
                          </Text>
                        </HStack>
                      </Button>
                    </>
                  ) : null}
                </Flex>
              ) : null}
              {interBlockGapHover && mouseInEditorChrome ? (
                <Flex
                  position="absolute"
                  left={`${interBlockGapHover.lineLeft}px`}
                  w={`${interBlockGapHover.lineWidth}px`}
                  top={`${interBlockGapHover.midY}px`}
                  transform="translateY(-50%)"
                  align="center"
                  gap={1}
                  zIndex={4}
                  h="26px"
                  pointerEvents="none"
                >
                  <Box flex="1" h="1px" bg="blackAlpha.200" borderRadius="full" pointerEvents="none" />
                  <IconButton
                    aria-label="Start new section below"
                    title="New section"
                    size="xs"
                    variant="ghost"
                    colorPalette="gray"
                    flexShrink={0}
                    minW="26px"
                    h="26px"
                    borderRadius="full"
                    opacity={0.9}
                    pointerEvents="auto"
                    _hover={{ opacity: 1, bg: "blackAlpha.50" }}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      insertManualSectionAfterBlock(interBlockGapHover.afterBlock);
                    }}
                  >
                    <Plus size={15} strokeWidth={2.25} />
                  </IconButton>
                </Flex>
              ) : null}
              {(() => {
                const showHoverOutline =
                  sectionHoverHighlight && mouseInEditorChrome && hoverRegion !== null;
                const hoverMatchesPinned =
                  hoverSectionBlocks !== null &&
                  pinnedSectionBlocks !== null &&
                  hoverSectionBlocks.b0 === pinnedSectionBlocks.b0 &&
                  hoverSectionBlocks.b1 === pinnedSectionBlocks.b1;

                // Pinned (outline-selected) gutter rule — same toggle as hover; off hides both.
                const showPinned =
                  pinnedRegion != null && sectionHoverHighlight;
                // Hover box — shown when hovering a *different* section than the selected one.
                const showHover = showHoverOutline && !hoverMatchesPinned && hoverRegion != null;

                return (
                  <>
                    {documentGutterMarks.map((m) => (
                      <SimpleGutterStripView key={m.key} strip={m} zIndex={2} />
                    ))}
                    {showPinned && pinnedRegion && (
                      <>
                        <IconButton
                          aria-label="Add section to agent chat"
                          size="xs"
                          variant="outline"
                          colorPalette="purple"
                          color={gutterAccentPalette.pinned.dot}
                          borderColor={gutterAccentPalette.pinned.line}
                          pointerEvents="auto"
                          position="absolute"
                          top={`${sparkleIconTopAlignedWithHeaderDot(pinnedRegion.top)}px`}
                          left={`${sparkleIconLeftOfGutterDot(pinnedRegion.left)}px`}
                          zIndex={3}
                          borderRadius="md"
                          minW={`${SPARKLE_BTN_PX}px`}
                          h={`${SPARKLE_BTN_PX}px`}
                          _hover={SPARKLE_BTN_HOVER}
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            runAddHoveredSection(ev);
                          }}
                        >
                          <Sparkles
                            size={13}
                            strokeWidth={1}
                            absoluteStrokeWidth
                            style={{ shapeRendering: "geometricPrecision" }}
                          />
                        </IconButton>
                      </>
                    )}
                    {showHover && hoverRegion && (
                      <>
                        <IconButton
                          aria-label="Add section to agent chat"
                          size="xs"
                          variant="outline"
                          color={gutterAccentPalette.hover.dot}
                          borderColor={gutterAccentPalette.hover.line}
                          pointerEvents="auto"
                          position="absolute"
                          top={`${sparkleIconTopAlignedWithHeaderDot(hoverRegion.top)}px`}
                          left={`${sparkleIconLeftOfGutterDot(hoverRegion.left)}px`}
                          zIndex={3}
                          borderRadius="md"
                          minW={`${SPARKLE_BTN_PX}px`}
                          h={`${SPARKLE_BTN_PX}px`}
                          _hover={SPARKLE_BTN_HOVER}
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            runAddHoveredSection(ev);
                          }}
                        >
                          <Sparkles
                            size={13}
                            strokeWidth={1}
                            absoluteStrokeWidth
                            style={{ shapeRendering: "geometricPrecision" }}
                          />
                        </IconButton>
                      </>
                    )}
                  </>
                );
              })()}
              <TableFloatingToolbar scrollContainerRef={wrapRef} />
              <TextSelectionFloatingToolbar scrollContainerRef={wrapRef} />
              <PlateContent
                className="markapp-plate-content markapp-light"
                placeholder="Start writing..."
                onPaste={handleEditorPaste}
                onBlur={flushMarkdownToParent}
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
    </>
  );
});

PlateEditorInner.displayName = "PlateEditor";

export const PlateEditor = memo(PlateEditorInner, arePlateEditorPropsEqual);
