import * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { Box, Button, HStack, IconButton, Menu, Separator, Text, Tooltip } from "@chakra-ui/react";
import { Editor, Range as SlateRange } from "slate";
import { ReactEditor } from "slate-react";
import { KEYS } from "platejs";
import { useEditorRef, useEditorSelector, useReadOnly } from "platejs/react";
import {
  Bold,
  ChevronDown,
  Code,
  Italic,
  Minus,
  Plus,
  Strikethrough,
  Underline,
} from "lucide-react";

import { chromeGhostIconProps } from "@/components/ui/quietFocusRing";
import { modShortcut } from "@/utils/platform";
import {
  BASE_FONT_SIZE_PX,
  FONT_SIZE_VALUES,
  nextFontSizeStep,
  parseFontSizePx,
  snapFontSizePx,
} from "@/utils/editorFontSize";
import { ALL_FONTS, FONT_COLOR_PRESETS, TOP_FONTS } from "./editorFontToolbarData";

const GAP_PX = 8;

const floatingMenuStyle = {
  borderRadius: "lg",
  boxShadow: "lg",
  py: 1,
  minW: "0",
  maxH: "min(60vh, 280px)",
  overflowY: "auto" as const,
};

const compactTriggerProps = {
  variant: "ghost" as const,
  size: "xs" as const,
  h: "26px",
  px: "5px",
  gap: "2px",
  fontWeight: "medium" as const,
  flexShrink: 0,
  ...chromeGhostIconProps,
};

function TTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root openDelay={400}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content px={2} py={1} fontSize="xs" maxW="240px">
          {label}
        </Tooltip.Content>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <Box px={3} pt={2} pb={1} pointerEvents="none">
      <Text fontSize="9px" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase" color="fg.muted">
        {children}
      </Text>
    </Box>
  );
}

function markBtn(active: boolean) {
  return active
    ? {
        bg: { _light: "blue.50", _dark: "rgba(59, 130, 246, 0.22)" },
        color: { _light: "blue.700", _dark: "blue.200" },
        _hover: { bg: { _light: "blue.100", _dark: "rgba(59, 130, 246, 0.32)" } },
      }
    : {};
}

function isEditorFocused(editor: unknown): boolean {
  try {
    return ReactEditor.isFocused(editor as unknown as Parameters<typeof ReactEditor.toDOMNode>[0]);
  } catch {
    return false;
  }
}

function selectionTouchesCodeBlock(editor: unknown): boolean {
  const ed = editor as { selection: SlateRange | null; api: { some: (opts: unknown) => boolean }; getType: (k: string) => string };
  if (!ed.selection) return false;
  try {
    const codeType = ed.getType(KEYS.codeBlock);
    return ed.api.some({
      at: ed.selection,
      match: { type: codeType },
    });
  } catch {
    return false;
  }
}

function targetIsInContentEditable(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[contenteditable="true"]');
}

/**
 * Bubble toolbar for expanded text selections: marks + font family / size / color.
 * Sits under `<Plate>` with the same hooks as the main toolbar.
 *
 * Stays hidden while the user is still holding the mouse/touch after pressing down in the editor
 * (drag-select). Appears after pointer release so it does not track the drag.
 */
export function TextSelectionFloatingToolbar({
  scrollContainerRef,
}: {
  scrollContainerRef: RefObject<HTMLElement | null>;
}) {
  const editor = useEditorRef();
  const readOnly = useReadOnly();

  /** True from primary pointer down in the editable until global pointer up/cancel. */
  const [pointerSelecting, setPointerSelecting] = useState(false);

  useEffect(() => {
    const wrap = scrollContainerRef.current;
    if (!wrap || readOnly) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!wrap.contains(e.target as Node)) return;
      if (!targetIsInContentEditable(e.target)) return;
      setPointerSelecting(true);
    };

    const onPointerUpOrCancel = () => setPointerSelecting(false);

    wrap.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUpOrCancel, true);
    window.addEventListener("pointercancel", onPointerUpOrCancel, true);
    return () => {
      wrap.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUpOrCancel, true);
      window.removeEventListener("pointercancel", onPointerUpOrCancel, true);
    };
  }, [scrollContainerRef, readOnly]);

  useEffect(() => {
    if (readOnly) setPointerSelecting(false);
  }, [readOnly]);

  const rangeKey = useEditorSelector((ed) => {
    const s = ed.selection;
    if (!s || !SlateRange.isExpanded(s)) return null;
    if (selectionTouchesCodeBlock(ed)) return null;
    const a = SlateRange.start(s);
    const b = SlateRange.end(s);
    return `${a.path.join(",")}:${a.offset}:${b.path.join(",")}:${b.offset}`;
  }, []);

  const focused = useEditorSelector((ed) => isEditorFocused(ed), []);
  const visible = rangeKey !== null && focused && !readOnly && !pointerSelecting;

  const fmt = useEditorSelector((ed) => {
    if (!ed.selection || !SlateRange.isExpanded(ed.selection)) {
      return {
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        code: false,
        fontColor: "",
        fontFamily: "",
        fontSize: "",
      };
    }
    const marks = (Editor.marks(ed as any) ?? {}) as Record<string, unknown>;
    return {
      bold: !!marks["bold"],
      italic: !!marks["italic"],
      underline: !!marks["underline"],
      strikethrough: !!marks["strikethrough"],
      code: !!marks["code"],
      fontColor: (marks["color"] as string) ?? "",
      fontFamily: (marks["fontFamily"] as string) ?? "",
      fontSize: (marks["fontSize"] as string) ?? "",
    };
  }, []);

  const currentSizePx = parseFontSizePx(fmt.fontSize);
  const effectiveSizePx = currentSizePx ?? BASE_FONT_SIZE_PX;
  const sizeDisplayLabel = String(effectiveSizePx);

  const familyLabel = (() => {
    if (!fmt.fontFamily) return "Font";
    const match = ALL_FONTS.find((f) => f.value === fmt.fontFamily);
    if (match) return match.name;
    return fmt.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
  })();

  const [layout, setLayout] = useState<{ top: number; left: number; place: "above" | "below" } | null>(null);

  const updatePosition = useCallback(() => {
    if (!visible || !editor.selection || !SlateRange.isExpanded(editor.selection)) {
      setLayout(null);
      return;
    }
    try {
      const domRange = ReactEditor.toDOMRange(
        editor as unknown as Parameters<typeof ReactEditor.toDOMRange>[0],
        editor.selection,
      );
      const rect = domRange.getBoundingClientRect();
      if ((rect.width === 0 && rect.height === 0) || (Number.isNaN(rect.left) && Number.isNaN(rect.top))) {
        setLayout(null);
        return;
      }
      const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
      const belowTop = rect.bottom + GAP_PX;
      const aboveTop = rect.top - GAP_PX;
      /** Prefer above the selection; fall back to below when the viewport top would clip the toolbar. */
      const toolbarEstimatePx = 100;
      const minTopMargin = 52;
      const canFitAbove = aboveTop - toolbarEstimatePx >= minTopMargin;
      const canFitBelow = belowTop + toolbarEstimatePx < viewportH;
      const place: "above" | "below" =
        canFitAbove ? "above" : canFitBelow ? "below" : "above";
      const top =
        place === "above" ? Math.max(minTopMargin, aboveTop) : belowTop;
      setLayout({
        top,
        left: rect.left + rect.width / 2,
        place,
      });
    } catch {
      setLayout(null);
    }
  }, [visible, editor, rangeKey]);

  useLayoutEffect(() => {
    updatePosition();
    if (!visible) return;
    const sc = scrollContainerRef.current;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => updatePosition()) : null;
    if (ro && sc) ro.observe(sc);
    sc?.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      ro?.disconnect();
      sc?.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [visible, updatePosition, scrollContainerRef]);

  const run = (fn: (ed: any) => void) => {
    fn(editor);
    editor.tf.focus();
    queueMicrotask(updatePosition);
  };

  const setFontFamily = (family: string) => {
    run((e) => {
      if (!family) Editor.removeMark(e, "fontFamily");
      else e.tf.fontFamily?.addMark?.(family);
    });
  };

  const setFontSizePx = (n: number) => {
    const snapped = snapFontSizePx(n);
    run((e) => e.tf.fontSize?.addMark?.(`${snapped}px`));
  };

  const bumpFontSize = (dir: 1 | -1) => {
    const next = nextFontSizeStep(effectiveSizePx, dir);
    if (next != null) setFontSizePx(next);
  };

  if (!visible || !layout) return null;

  return (
    <Box
      position="fixed"
      zIndex={36}
      top={`${layout.top}px`}
      left={`${layout.left}px`}
      transform={layout.place === "below" ? "translate(-50%, 0)" : "translate(-50%, -100%)"}
      pointerEvents="auto"
      onMouseDown={(e) => e.preventDefault()}
    >
      <HStack
        gap={0}
        px={1}
        py={0.5}
        flexWrap="wrap"
        maxW="min(96vw, 520px)"
        borderRadius="md"
        borderWidth="1px"
        borderColor={{ _light: "blackAlpha.200", _dark: "whiteAlpha.200" }}
        bg={{ _light: "white", _dark: "gray.800" }}
        boxShadow="lg"
      >
        <TTip label={`Bold (${modShortcut("B")})`}>
          <IconButton
            aria-label="Bold"
            size="xs"
            variant="ghost"
            {...chromeGhostIconProps}
            onClick={() => run((e) => e.tf.bold.toggle())}
            {...markBtn(fmt.bold)}
          >
            <Bold size={14} />
          </IconButton>
        </TTip>
        <TTip label={`Italic (${modShortcut("I")})`}>
          <IconButton
            aria-label="Italic"
            size="xs"
            variant="ghost"
            {...chromeGhostIconProps}
            onClick={() => run((e) => e.tf.italic.toggle())}
            {...markBtn(fmt.italic)}
          >
            <Italic size={14} />
          </IconButton>
        </TTip>
        <TTip label={`Underline (${modShortcut("U")})`}>
          <IconButton
            aria-label="Underline"
            size="xs"
            variant="ghost"
            {...chromeGhostIconProps}
            onClick={() => run((e) => e.tf.underline.toggle())}
            {...markBtn(fmt.underline)}
          >
            <Underline size={14} />
          </IconButton>
        </TTip>
        <TTip label="Strikethrough">
          <IconButton
            aria-label="Strikethrough"
            size="xs"
            variant="ghost"
            {...chromeGhostIconProps}
            onClick={() => run((e) => e.tf.strikethrough.toggle())}
            {...markBtn(fmt.strikethrough)}
          >
            <Strikethrough size={14} />
          </IconButton>
        </TTip>
        <TTip label="Inline code">
          <IconButton
            aria-label="Inline code"
            size="xs"
            variant="ghost"
            {...chromeGhostIconProps}
            onClick={() => run((e) => e.tf.code.toggle())}
            {...markBtn(fmt.code)}
          >
            <Code size={14} />
          </IconButton>
        </TTip>

        <Separator orientation="vertical" h="20px" mx={0.5} />

        <Text fontSize="9px" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider" alignSelf="center" px={1} userSelect="none">
          Font
        </Text>

        <Menu.Root>
          <Menu.Trigger asChild>
            <Button {...compactTriggerProps} w="76px" minW="76px" aria-label="Font family">
              <Text fontSize="10px" fontWeight="medium" truncate flex="1" textAlign="left" style={{ fontFamily: fmt.fontFamily || "inherit" }}>
                {familyLabel}
              </Text>
              <ChevronDown size={10} style={{ flexShrink: 0, opacity: 0.55 }} />
            </Button>
          </Menu.Trigger>
          <Menu.Positioner>
            <Menu.Content {...floatingMenuStyle} minW="168px">
              <Menu.Item value="__default__" onSelect={() => setFontFamily("")}>
                <Text fontSize="12px" color={!fmt.fontFamily ? "blue.500" : "fg"} fontWeight={!fmt.fontFamily ? "semibold" : "normal"}>
                  — Default —
                </Text>
              </Menu.Item>
              <Menu.Separator />
              <MenuSectionLabel>Frequently used</MenuSectionLabel>
              {TOP_FONTS.map((f) => (
                <Menu.Item key={`top-${f.value}`} value={`top-${f.value}`} onSelect={() => setFontFamily(f.value)}>
                  <Text fontSize="12px" style={{ fontFamily: f.value }} color={fmt.fontFamily === f.value ? "blue.500" : "fg"} fontWeight={fmt.fontFamily === f.value ? "semibold" : "normal"}>
                    {f.name}
                  </Text>
                </Menu.Item>
              ))}
              <Menu.Separator />
              <MenuSectionLabel>All fonts</MenuSectionLabel>
              {ALL_FONTS.map((f) => (
                <Menu.Item key={f.value} value={f.value} onSelect={() => setFontFamily(f.value)}>
                  <Text fontSize="12px" style={{ fontFamily: f.value }} color={fmt.fontFamily === f.value ? "blue.500" : "fg"} fontWeight={fmt.fontFamily === f.value ? "semibold" : "normal"}>
                    {f.name}
                  </Text>
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>

        <HStack gap={0} align="center">
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button {...compactTriggerProps} w="44px" minW="44px" aria-label="Font size">
                <Text fontSize="10px" fontWeight="medium" flex="1" textAlign="left">
                  {sizeDisplayLabel}
                </Text>
                <ChevronDown size={10} style={{ flexShrink: 0, opacity: 0.55 }} />
              </Button>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content {...floatingMenuStyle} minW="64px" maxH="200px" py={1}>
                {FONT_SIZE_VALUES.map((sz) => (
                  <Menu.Item key={sz} value={String(sz)} onSelect={() => setFontSizePx(sz)}>
                    <Text fontSize="11px" fontWeight={currentSizePx === sz ? "semibold" : "normal"} color={currentSizePx === sz ? "blue.500" : "fg"}>
                      {sz}
                    </Text>
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
          <TTip label={`Larger (${modShortcut("]")})`}>
            <IconButton aria-label="Larger text" size="xs" variant="ghost" {...chromeGhostIconProps} minW="24px" h="26px" onClick={() => bumpFontSize(1)}>
              <Plus size={14} />
            </IconButton>
          </TTip>
          <TTip label={`Smaller (${modShortcut("[")})`}>
            <IconButton aria-label="Smaller text" size="xs" variant="ghost" {...chromeGhostIconProps} minW="24px" h="26px" onClick={() => bumpFontSize(-1)}>
              <Minus size={14} />
            </IconButton>
          </TTip>
        </HStack>

        <Menu.Root>
          <Menu.Trigger asChild>
            <Box
              as="button"
              display="flex"
              alignItems="center"
              justifyContent="center"
              h="26px"
              w="26px"
              borderRadius="md"
              cursor="pointer"
              flexShrink={0}
              {...chromeGhostIconProps}
              _hover={{ bg: { _light: "blackAlpha.80", _dark: "whiteAlpha.80" } }}
              aria-label="Font color"
            >
              <Box display="flex" flexDirection="column" alignItems="center" gap="1px">
                <Text fontSize="11px" lineHeight="1" userSelect="none">
                  A
                </Text>
                <Box h="2px" w="11px" borderRadius="full" style={{ backgroundColor: fmt.fontColor || "currentColor" }} />
              </Box>
            </Box>
          </Menu.Trigger>
          <Menu.Positioner>
            <Menu.Content {...floatingMenuStyle} minW="132px" p={2}>
              <Menu.Item value="__default__" onSelect={() => run((e) => Editor.removeMark(e, "color"))} py={1.5} cursor="pointer" borderRadius="md">
                <Text fontSize="11px" fontWeight={!fmt.fontColor ? "semibold" : "normal"} color={!fmt.fontColor ? "blue.500" : "fg"}>
                  Default
                </Text>
              </Menu.Item>
              <Box display="grid" gridTemplateColumns="repeat(5, 1fr)" gap={1} pt={1}>
                {FONT_COLOR_PRESETS.map((c) => {
                  const active = fmt.fontColor.toLowerCase() === c.value.toLowerCase();
                  return (
                    <Menu.Item
                      key={c.value}
                      value={c.value}
                      onSelect={() => run((e) => e.tf.color?.addMark?.(c.value))}
                      cursor="pointer"
                      p={1}
                      minH="0"
                      h="auto"
                      justifyContent="center"
                      alignItems="center"
                      borderRadius="md"
                      title={c.label}
                      aria-label={c.label}
                    >
                      <Box
                        w="18px"
                        h="18px"
                        borderRadius="sm"
                        borderWidth="2px"
                        borderColor={active ? "blue.500" : "border"}
                        style={{ backgroundColor: c.value }}
                      />
                    </Menu.Item>
                  );
                })}
              </Box>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>
      </HStack>
    </Box>
  );
}
