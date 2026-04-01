import { useEffect, useState, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { Box, IconButton, HStack, Separator, Tooltip, Text, Menu, Button } from "@chakra-ui/react";
import { ListStyleType, someList, toggleList } from "@platejs/list";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Code,
  FileCode2,
  Quote,
  Minus,
  PanelRight,
  Highlighter,
  ChevronDown,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Image as ImageIcon,
} from "lucide-react";
import { insertImage } from "@platejs/media";
import { Editor } from "slate";
import type { PlateEditorHandle } from "./PlateEditor";
import { TableToolbarButton } from "./TableToolbarButton";
import type { Alignment } from "@platejs/basic-styles";
import { modShortcut } from "@/utils/platform";
import { chromeGhostIconProps, quietFocusRing } from "@/components/ui/quietFocusRing";
import {
  BASE_FONT_SIZE_PX,
  FONT_SIZE_VALUES,
  parseFontSizePx,
  snapFontSizePx,
  nextFontSizeStep,
} from "@/utils/editorFontSize";
import { ALL_FONTS, FONT_COLOR_PRESETS, TOP_FONTS } from "./editorFontToolbarData";

// ---------------------------------------------------------------------------
// Tooltip helper
// ---------------------------------------------------------------------------

/** Toolbar accent for grow/shrink wedges (Chakra token + hex fallbacks, aligns with editor accent). */
const ACCENT_UP = "var(--chakra-colors-blue-500, #3b82f6)";
const ACCENT_DOWN = "var(--chakra-colors-blue-400, #60a5fa)";

/** Shared "A" geometry so grow/shrink icons align in the toolbar (baseline y=12.5, cap ~y 3.6). */
const GLYPH_A = {
  x: 0,
  y: 12.5,
  size: 12,
  /** Prefer faces with light masters; numeric weight on <text> via inline style (see glyphs) */
  family:
    "'Segoe UI Variable Text', 'Segoe UI Light', 'Segoe UI', 'Calibri Light', Calibri, system-ui, sans-serif",
};

/** Inline fontWeight so it wins over Chakra IconButton recipe (`fontWeight: medium` on button cascades into SVG text). */
const GLYPH_A_TEXT_STYLE: CSSProperties = {
  fontWeight: 250,
};

/**
 * MS Word–style Grow / Shrink Font: same A; ▲ tucked in top-right of the cap, ▼ in bottom-right at baseline.
 */
function GrowFontGlyph({ boxSize = 15 }: { boxSize?: number }) {
  return (
    <svg
      width={boxSize}
      height={boxSize}
      viewBox="0 0 16 16"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <text
        x={GLYPH_A.x}
        y={GLYPH_A.y}
        fontSize={GLYPH_A.size}
        fill="currentColor"
        fontFamily={GLYPH_A.family}
        style={GLYPH_A_TEXT_STYLE}
      >
        A
      </text>
      {/* Up caret: larger wedge, upper-right of A */}
      <path d="M 12.0 2.1 L 14.7 6.5 H 9.3 Z" fill={ACCENT_UP} />
    </svg>
  );
}

function ShrinkFontGlyph({ boxSize = 15 }: { boxSize?: number }) {
  return (
    <svg
      width={boxSize}
      height={boxSize}
      viewBox="0 0 16 16"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <text
        x={GLYPH_A.x}
        y={GLYPH_A.y}
        fontSize={GLYPH_A.size}
        fill="currentColor"
        fontFamily={GLYPH_A.family}
        style={GLYPH_A_TEXT_STYLE}
      >
        A
      </text>
      {/* Down caret: lower-right, nudged farther right than grow ▲ */}
      <path d="M 13.1 14.7 L 15.85 10.1 H 10.35 Z" fill={ACCENT_DOWN} />
    </svg>
  );
}

function TBarTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root openDelay={600}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content px={2} py={1} fontSize="xs" maxW="240px">
          {label}
        </Tooltip.Content>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

// ---------------------------------------------------------------------------
// Group label rendered below the row of buttons
// ---------------------------------------------------------------------------
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      fontSize="9px"
      fontWeight="medium"
      color="fg.subtle"
      textTransform="uppercase"
      letterSpacing="wider"
      textAlign="center"
      lineHeight="1"
      mt="1px"
      userSelect="none"
      aria-hidden
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Toolbar group: children row above a label
// ---------------------------------------------------------------------------
function ToolbarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" alignItems="center" gap="1px" flexShrink={0}>
      <HStack gap={0} align="center">
        {children}
      </HStack>
      <GroupLabel>{label}</GroupLabel>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Reusable styles for dropdown trigger buttons
// ---------------------------------------------------------------------------
const dropdownTriggerProps = {
  variant: "ghost" as const,
  size: "sm" as const,
  h: "28px",
  px: "6px",
  justifyContent: "space-between",
  gap: "2px",
  fontWeight: "medium",
  flexShrink: 0,
  ...chromeGhostIconProps,
} as const;

// ---------------------------------------------------------------------------
// Format state
// ---------------------------------------------------------------------------
type FmtState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  block?: string;
  bulletList: boolean;
  numberedList: boolean;
  fontColor: string;
  fontFamily: string;
  fontSize: string;
  /** Block `textAlign` from Plate (`start` / `left` = default flush left). */
  textAlign?: Alignment;
};

function fmtStateEqual(a: FmtState, b: FmtState): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.code === b.code &&
    a.block === b.block &&
    a.bulletList === b.bulletList &&
    a.numberedList === b.numberedList &&
    a.fontColor === b.fontColor &&
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.textAlign === b.textAlign
  );
}

// ---------------------------------------------------------------------------
// Menu item section label (non-interactive divider label)
// ---------------------------------------------------------------------------
function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <Box
      px={3}
      pt={2}
      pb={1}
      pointerEvents="none"
    >
      <Text
        fontSize="9px"
        fontWeight="semibold"
        letterSpacing="wider"
        textTransform="uppercase"
        color="fg.muted"
      >
        {children}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Shared menu content style
// ---------------------------------------------------------------------------
const menuContentStyle = {
  borderRadius: "lg",
  boxShadow: "lg",
  py: 1,
  minW: "0",
} as const;

// ---------------------------------------------------------------------------
// Main toolbar
// ---------------------------------------------------------------------------
export function EditorToolbar({
  editorRef,
  agentOpen,
  onToggleAgent,
  sectionHoverHighlight,
  onToggleSectionHoverHighlight,
}: {
  editorRef: React.RefObject<PlateEditorHandle | null>;
  agentOpen: boolean;
  onToggleAgent: () => void;
  sectionHoverHighlight: boolean;
  onToggleSectionHoverHighlight: () => void;
}) {
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const [fmt, setFmt] = useState<FmtState>({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    code: false,
    block: undefined,
    bulletList: false,
    numberedList: false,
    fontColor: "",
    fontFamily: "",
    fontSize: "",
    textAlign: undefined,
  });

  const tick = useCallback(() => {
    const editor = editorRef.current?.getEditor() as any;
    if (!editor?.selection) return;
    try {
      const marks = (Editor.marks(editor) ?? {}) as Record<string, unknown>;
      const block = editor.api?.block?.({ highest: true });
      const blockType = block?.[0]?.type as string | undefined;
      const blockAlign = (block?.[0] as Record<string, unknown> | undefined)?.["textAlign"] as
        | Alignment
        | undefined;
      const nextFmt: FmtState = {
        bold: !!marks["bold"],
        italic: !!marks["italic"],
        underline: !!marks["underline"],
        strikethrough: !!marks["strikethrough"],
        code: !!marks["code"],
        block: blockType,
        bulletList: someList(editor, ListStyleType.Disc),
        numberedList: someList(editor, ListStyleType.Decimal),
        fontColor: (marks["color"] as string) ?? "",
        fontFamily: (marks["fontFamily"] as string) ?? "",
        fontSize: (marks["fontSize"] as string) ?? "",
        textAlign: blockAlign,
      };
      setFmt((prev) => (fmtStateEqual(prev, nextFmt) ? prev : nextFmt));
    } catch {
      /* selection / api edge cases */
    }
  }, [editorRef]);

  useEffect(() => {
    const id = window.setInterval(tick, 120);
    return () => window.clearInterval(id);
  }, [tick]);

  const run = (fn: (editor: any) => void) => {
    const editor = editorRef.current?.getEditor();
    if (editor) fn(editor);
    queueMicrotask(tick);
  };

  const markBtn = (active: boolean) =>
    active
      ? {
          bg: { _light: "blue.50", _dark: "rgba(59, 130, 246, 0.22)" },
          color: { _light: "blue.700", _dark: "blue.200" },
          _hover: {
            bg: { _light: "blue.100", _dark: "rgba(59, 130, 246, 0.32)" },
          },
        }
      : {};

  // ── Font family ─────────────────────────────────────────────────────────
  // Display the matched name or first word of the raw value
  const familyLabel = (() => {
    if (!fmt.fontFamily) return "Font";
    const match = ALL_FONTS.find((f) => f.value === fmt.fontFamily);
    if (match) return match.name;
    return fmt.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
  })();

  const setFontFamily = (family: string) => {
    run((e) => {
      if (!family) {
        Editor.removeMark(e, "fontFamily");
      } else {
        e.tf.fontFamily?.addMark?.(family);
      }
    });
  };

  // ── Font size ───────────────────────────────────────────────────────────
  const currentSizePx = parseFontSizePx(fmt.fontSize);
  /** Shown in toolbar + used for grow/shrink when no mark is set */
  const effectiveSizePx = currentSizePx ?? BASE_FONT_SIZE_PX;
  const sizeDisplayLabel = String(effectiveSizePx);

  const setFontSizePx = (n: number) => {
    const snapped = snapFontSizePx(n);
    run((e) => e.tf.fontSize?.addMark?.(`${snapped}px`));
  };

  const bumpFontSize = (dir: 1 | -1) => {
    const next = nextFontSizeStep(effectiveSizePx, dir);
    if (next != null) setFontSizePx(next);
  };

  // ── Font color ──────────────────────────────────────────────────────────
  const setFontColor = (color: string) => {
    run((e) => {
      e.tf.color?.addMark?.(color);
    });
  };

  const clearFontColor = () => {
    run((e) => Editor.removeMark(e, "color"));
  };

  const alignIsDefaultLeft = (a: Alignment | undefined) =>
    a == null || a === "start" || a === "left";

  const setBlockAlign = (value: Alignment) => {
    run((e) => {
      e.tf.textAlign?.setNodes?.(value);
    });
  };

  return (
    <Box borderBottomWidth="1px" px={2} py={0.5} bg="bg.muted" flexShrink={0}>
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/*"
        aria-hidden
        tabIndex={-1}
        style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
        onChange={(ev) => {
          const files = ev.target.files;
          if (files?.length) {
            run((e: { tf: { insert: { imageFromFiles: (f: FileList) => void } } }) => {
              e.tf.insert.imageFromFiles(files);
            });
          }
          ev.target.value = "";
        }}
      />
      <HStack gap={0} flexWrap="wrap" align="flex-start" justify="space-between" minH="38px">

        {/* ── Left: formatting groups ─────────────────────────────── */}
        <HStack gap={0} flexWrap="wrap" align="flex-start">

          {/* ── FONT group ──────────────────────────────────────────── */}
          <ToolbarGroup label="Font">

            {/* Font family picker */}
            <TBarTip label="Font family">
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button {...dropdownTriggerProps} w="96px" aria-label="Font family">
                    <Text
                      fontSize="11px"
                      fontWeight="medium"
                      color="fg"
                      lineHeight="1"
                      truncate
                      flex="1"
                      textAlign="left"
                      style={{ fontFamily: fmt.fontFamily || "inherit" }}
                    >
                      {familyLabel}
                    </Text>
                    <ChevronDown size={9} style={{ flexShrink: 0, opacity: 0.5 }} />
                  </Button>
                </Menu.Trigger>
                <Menu.Positioner>
                  <Menu.Content {...menuContentStyle} minW="180px" maxH="260px" overflowY="auto">

                    {/* Reset to default */}
                    <Menu.Item value="__default__" onSelect={() => setFontFamily("")}>
                      <Text fontSize="12px" color={!fmt.fontFamily ? "blue.500" : "fg"} fontWeight={!fmt.fontFamily ? "semibold" : "normal"}>
                        — Default —
                      </Text>
                    </Menu.Item>

                    <Menu.Separator />
                    <MenuSectionLabel>Frequently used</MenuSectionLabel>

                    {TOP_FONTS.map((f) => (
                      <Menu.Item key={`top-${f.value}`} value={`top-${f.value}`} onSelect={() => setFontFamily(f.value)}>
                        <Text
                          fontSize="13px"
                          style={{ fontFamily: f.value }}
                          color={fmt.fontFamily === f.value ? "blue.500" : "fg"}
                          fontWeight={fmt.fontFamily === f.value ? "semibold" : "normal"}
                        >
                          {f.name}
                        </Text>
                      </Menu.Item>
                    ))}

                    <Menu.Separator />
                    <MenuSectionLabel>All fonts</MenuSectionLabel>

                    {ALL_FONTS.map((f) => (
                      <Menu.Item key={f.value} value={f.value} onSelect={() => setFontFamily(f.value)}>
                        <Text
                          fontSize="13px"
                          style={{ fontFamily: f.value }}
                          color={fmt.fontFamily === f.value ? "blue.500" : "fg"}
                          fontWeight={fmt.fontFamily === f.value ? "semibold" : "normal"}
                        >
                          {f.name}
                        </Text>
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>
            </TBarTip>

            {/* Font size: dropdown, then Grow (Word-style), then Shrink */}
            <HStack gap={0} align="center" flexShrink={0}>
              <TBarTip label="Font size (px)">
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Button {...dropdownTriggerProps} w="52px" minW="52px" aria-label="Font size">
                      <Text fontSize="11px" fontWeight="medium" color="fg" lineHeight="1" flex="1" textAlign="left">
                        {sizeDisplayLabel}
                      </Text>
                      <ChevronDown size={9} style={{ flexShrink: 0, opacity: 0.5 }} />
                    </Button>
                  </Menu.Trigger>
                  <Menu.Positioner>
                    <Menu.Content {...menuContentStyle} minW="72px" maxH="220px" overflowY="auto" py={1}>
                      {FONT_SIZE_VALUES.map((sz) => (
                        <Menu.Item key={sz} value={String(sz)} onSelect={() => setFontSizePx(sz)}>
                          <Text
                            fontSize="12px"
                            fontWeight={currentSizePx === sz ? "semibold" : "normal"}
                            color={currentSizePx === sz ? "blue.500" : "fg"}
                          >
                            {sz}
                          </Text>
                        </Menu.Item>
                      ))}
                    </Menu.Content>
                  </Menu.Positioner>
                </Menu.Root>
              </TBarTip>
              <TBarTip label={`Grow Font (${modShortcut("]")})`}>
                <IconButton
                  aria-label="Grow Font"
                  size="sm"
                  variant="ghost"
                  {...chromeGhostIconProps}
                  minW="28px"
                  w="28px"
                  h="28px"
                  onClick={() => bumpFontSize(1)}
                >
                  <GrowFontGlyph boxSize={15} />
                </IconButton>
              </TBarTip>
              <TBarTip label={`Shrink Font (${modShortcut("[")})`}>
                <IconButton
                  aria-label="Shrink Font"
                  size="sm"
                  variant="ghost"
                  {...chromeGhostIconProps}
                  minW="28px"
                  w="28px"
                  h="28px"
                  onClick={() => bumpFontSize(-1)}
                >
                  <ShrinkFontGlyph boxSize={15} />
                </IconButton>
              </TBarTip>
            </HStack>

            {/* Font color palette */}
            <TBarTip label="Font color">
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Box
                    as="button"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    h="28px"
                    w="28px"
                    borderRadius="md"
                    cursor="pointer"
                    flexShrink={0}
                    {...quietFocusRing}
                    _hover={{ bg: { _light: "blackAlpha.80", _dark: "whiteAlpha.80" } }}
                    aria-label="Font color"
                  >
                    <Box display="flex" flexDirection="column" alignItems="center" gap="1.5px">
                      <Text
                        fontSize="12px"
                        color="fg"
                        lineHeight="1"
                        userSelect="none"
                        fontFamily={GLYPH_A.family}
                        style={GLYPH_A_TEXT_STYLE}
                      >
                        A
                      </Text>
                      <Box
                        h="2.5px"
                        w="12px"
                        borderRadius="full"
                        style={{ backgroundColor: fmt.fontColor || "currentColor" }}
                      />
                    </Box>
                  </Box>
                </Menu.Trigger>
                <Menu.Positioner>
                  <Menu.Content {...menuContentStyle} minW="140px" p={2}>
                    <Menu.Item
                      value="__default__"
                      onSelect={clearFontColor}
                      py={1.5}
                      cursor="pointer"
                      borderRadius="md"
                      transition="background 0.15s ease"
                      _hover={{ bg: { _light: "blackAlpha.50", _dark: "whiteAlpha.100" } }}
                    >
                      <Text fontSize="12px" fontWeight={!fmt.fontColor ? "semibold" : "normal"} color={!fmt.fontColor ? "blue.500" : "fg"}>
                        Default
                      </Text>
                    </Menu.Item>
                    <Box display="grid" gridTemplateColumns="repeat(5, 1fr)" gap={1.5} pt={1}>
                      {FONT_COLOR_PRESETS.map((c) => {
                        const active = fmt.fontColor.toLowerCase() === c.value.toLowerCase();
                        return (
                          <Menu.Item
                            key={c.value}
                            value={c.value}
                            onSelect={() => setFontColor(c.value)}
                            cursor="pointer"
                            p={1}
                            minH="0"
                            h="auto"
                            minW="0"
                            justifyContent="center"
                            alignItems="center"
                            borderRadius="md"
                            transition="background 0.15s ease"
                            title={c.label}
                            aria-label={c.label}
                            _hover={{
                              bg: { _light: "blackAlpha.50", _dark: "whiteAlpha.100" },
                            }}
                            css={{
                              "&:hover [data-palette-swatch]": {
                                transform: "scale(1.12)",
                                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
                              },
                              ".dark &:hover [data-palette-swatch]": {
                                boxShadow: "0 2px 10px rgba(0, 0, 0, 0.45)",
                              },
                            }}
                          >
                            <Box
                              data-palette-swatch
                              w="22px"
                              h="22px"
                              borderRadius="sm"
                              borderWidth="2px"
                              borderColor={active ? "blue.500" : "border"}
                              style={{ backgroundColor: c.value }}
                              transition="transform 0.15s ease, box-shadow 0.15s ease"
                            />
                          </Menu.Item>
                        );
                      })}
                    </Box>
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>
            </TBarTip>

            <Separator orientation="vertical" h="18px" mx={0.5} />

            {/* Text marks */}
            <TBarTip label={`Bold (${modShortcut("B")})`}>
              <IconButton aria-label="Bold" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() => run((e) => e.tf.bold.toggle())} {...markBtn(fmt.bold)}>
                <Bold size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label={`Italic (${modShortcut("I")})`}>
              <IconButton aria-label="Italic" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() => run((e) => e.tf.italic.toggle())} {...markBtn(fmt.italic)}>
                <Italic size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label={`Underline (${modShortcut("U")})`}>
              <IconButton aria-label="Underline" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() => run((e) => e.tf.underline.toggle())} {...markBtn(fmt.underline)}>
                <Underline size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label="Strikethrough">
              <IconButton aria-label="Strikethrough" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() => run((e) => e.tf.strikethrough.toggle())} {...markBtn(fmt.strikethrough)}>
                <Strikethrough size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label="Inline code">
              <IconButton aria-label="Inline code" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() => run((e) => e.tf.code.toggle())} {...markBtn(fmt.code)}>
                <Code size={14} />
              </IconButton>
            </TBarTip>
          </ToolbarGroup>

          <Separator orientation="vertical" h="38px" mx={1} />

          {/* ── PARAGRAPH group ─────────────────────────────────────── */}
          <ToolbarGroup label="Paragraph">
            <TBarTip label="Bullet list">
              <IconButton aria-label="Bullet list" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() => run((e) => toggleList(e, { listStyleType: ListStyleType.Disc }))}
                {...markBtn(fmt.bulletList)}>
                <List size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label="Numbered list">
              <IconButton aria-label="Numbered list" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() => run((e) => toggleList(e, { listStyleType: ListStyleType.Decimal }))}
                {...markBtn(fmt.numberedList)}>
                <ListOrdered size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label="Horizontal rule">
              <IconButton aria-label="Horizontal rule" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() =>
                  run((e) => {
                    e.tf.insertNodes({ type: "hr", children: [{ text: "" }] });
                    e.tf.insertNodes({ type: "p", children: [{ text: "" }] });
                  })
                }>
                <Minus size={14} />
              </IconButton>
            </TBarTip>
          </ToolbarGroup>

          <Separator orientation="vertical" h="38px" mx={1} />

          {/* ── ALIGN group ─────────────────────────────────────────── */}
          <ToolbarGroup label="Align">
            <TBarTip label="Align left">
              <IconButton
                aria-label="Align left"
                size="sm"
                variant="ghost"
                {...chromeGhostIconProps}
                onClick={() => setBlockAlign("start")}
                {...markBtn(alignIsDefaultLeft(fmt.textAlign))}
              >
                <AlignLeft size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label="Align center">
              <IconButton
                aria-label="Align center"
                size="sm"
                variant="ghost"
                {...chromeGhostIconProps}
                onClick={() => setBlockAlign("center")}
                {...markBtn(fmt.textAlign === "center")}
              >
                <AlignCenter size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label="Align right">
              <IconButton
                aria-label="Align right"
                size="sm"
                variant="ghost"
                {...chromeGhostIconProps}
                onClick={() => setBlockAlign("right")}
                {...markBtn(fmt.textAlign === "right" || fmt.textAlign === "end")}
              >
                <AlignRight size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label="Justify">
              <IconButton
                aria-label="Justify"
                size="sm"
                variant="ghost"
                {...chromeGhostIconProps}
                onClick={() => setBlockAlign("justify")}
                {...markBtn(fmt.textAlign === "justify")}
              >
                <AlignJustify size={14} />
              </IconButton>
            </TBarTip>
          </ToolbarGroup>

          <Separator orientation="vertical" h="38px" mx={1} />

          {/* ── BLOCKS group ────────────────────────────────────────── */}
          <ToolbarGroup label="Blocks">
            <TBarTip label="Blockquote">
              <IconButton aria-label="Blockquote" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() => run((e) => e.tf.blockquote.toggle())}
                {...markBtn(fmt.block === "blockquote")}>
                <Quote size={14} />
              </IconButton>
            </TBarTip>
            <TBarTip label="Code block (Mod+Alt+8)">
              <IconButton aria-label="Code block" size="sm" variant="ghost" {...chromeGhostIconProps}
                onClick={() => run((e) => { const tf = (e as any).tf; tf.code_block?.toggle?.(); })}
                {...markBtn(fmt.block === "code_block")}>
                <FileCode2 size={14} />
              </IconButton>
            </TBarTip>
          </ToolbarGroup>

          <Separator orientation="vertical" h="38px" mx={1} />

          {/* ── INSERT group (Plate media + table) ──────────────────── */}
          <ToolbarGroup label="Insert">
            <TBarTip label="Table — insert grid, merge/split, rows & columns (Plate toolbar)">
              <TableToolbarButton editorRef={editorRef} onAfterCommand={tick} />
            </TBarTip>
            <TBarTip label="Insert image">
              <Menu.Root>
                <Menu.Trigger asChild>
                  <IconButton aria-label="Insert image" size="sm" variant="ghost" {...chromeGhostIconProps}>
                    <ImageIcon size={14} />
                  </IconButton>
                </Menu.Trigger>
                <Menu.Positioner>
                  <Menu.Content {...menuContentStyle} minW="160px" py={1}>
                    <Menu.Item
                      value="upload"
                      onSelect={() => {
                        queueMicrotask(() => imageFileInputRef.current?.click());
                      }}
                    >
                      <Text fontSize="12px">Upload from computer…</Text>
                    </Menu.Item>
                    <Menu.Item
                      value="url"
                      onSelect={() => {
                        const url = typeof window !== "undefined" ? window.prompt("Image URL") : null;
                        const trimmed = url?.trim();
                        if (trimmed) run((ed) => insertImage(ed, trimmed));
                      }}
                    >
                      <Text fontSize="12px">From URL…</Text>
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>
            </TBarTip>
          </ToolbarGroup>
        </HStack>

        {/* ── Right: view toggles ─────────────────────────────────── */}
        <HStack gap={1} flexShrink={0} align="center" h="38px">
          <TBarTip
            label={sectionHoverHighlight
              ? "Sections on (sidebar outline + margin bars) — click to hide all"
              : "Sections off — click to show outline and margin bars"
            }
          >
            <IconButton
              aria-label={sectionHoverHighlight ? "Turn off sections (outline + margins)" : "Turn on sections (outline + margins)"}
              size="xs"
              variant={sectionHoverHighlight ? "subtle" : "ghost"}
              colorPalette="purple"
              {...(sectionHoverHighlight ? quietFocusRing : chromeGhostIconProps)}
              onClick={onToggleSectionHoverHighlight}
            >
              <Highlighter size={13.6} strokeWidth={1.75} />
            </IconButton>
          </TBarTip>
          <TBarTip label={`${agentOpen ? "Hide" : "Show"} Claude panel (${modShortcut("L")})`}>
            <IconButton
              aria-label={agentOpen ? "Hide agent panel" : "Show agent panel"}
              size="xs"
              variant={agentOpen ? "subtle" : "ghost"}
              colorPalette="blue"
              {...(agentOpen ? quietFocusRing : chromeGhostIconProps)}
              onClick={onToggleAgent}
            >
              <PanelRight size={13.6} strokeWidth={1.75} />
            </IconButton>
          </TBarTip>
        </HStack>

      </HStack>
    </Box>
  );
}
