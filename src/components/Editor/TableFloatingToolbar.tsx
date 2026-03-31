import * as React from "react";
import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { Box, HStack, IconButton, Separator, Tooltip } from "@chakra-ui/react";
import { getTableAbove } from "@platejs/table";
import { useTableMergeState } from "@platejs/table/react";
import { Range as SlateRange } from "slate";
import { ReactEditor } from "slate-react";
import { useEditorRef, useEditorSelector, useReadOnly } from "platejs/react";
import { ArrowDown, ArrowUp, Combine, Trash2, Ungroup } from "lucide-react";

import { chromeGhostIconProps } from "@/components/ui/quietFocusRing";

const GAP_PX = 8;

function TTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root openDelay={400}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content px={2} py={1} fontSize="xs" maxW="220px">
          {label}
        </Tooltip.Content>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

function isEditorFocused(editor: unknown): boolean {
  try {
    return ReactEditor.isFocused(editor as unknown as Parameters<typeof ReactEditor.toDOMNode>[0]);
  } catch {
    return false;
  }
}

/**
 * Plate-style floating toolbar when the selection is inside a table (merge/split/rows/delete).
 * Renders under `<Plate>` so {@link useTableMergeState} and editor refs work.
 */
export function TableFloatingToolbar({
  scrollContainerRef,
}: {
  scrollContainerRef: RefObject<HTMLElement | null>;
}) {
  const editor = useEditorRef();
  const readOnly = useReadOnly();
  const merge = useTableMergeState();

  const tablePathKey = useEditorSelector((ed) => {
    if (!ed.selection) return null;
    const t = getTableAbove(ed, { at: ed.selection });
    if (!t) return null;
    const sel = ed.selection;
    const anchorKey = SlateRange.isCollapsed(sel) ? sel.anchor.path.join(",") : "range";
    return `${t[1].join(",")}:${anchorKey}`;
  }, []);

  const inTable = tablePathKey !== null;
  const focused = useEditorSelector((ed) => isEditorFocused(ed), []);
  /** Hide while a text range is selected so the text floating toolbar can show instead. */
  const collapsed = useEditorSelector((ed) => {
    const s = ed.selection;
    return !!s && SlateRange.isCollapsed(s);
  }, []);
  const visible = inTable && focused && !readOnly && collapsed;

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (!visible) {
      setPos(null);
      return;
    }
    const t = getTableAbove(editor, { at: editor.selection ?? undefined });
    if (!t) {
      setPos(null);
      return;
    }
    try {
      const dom = ReactEditor.toDOMNode(editor as unknown as Parameters<typeof ReactEditor.toDOMNode>[0], t[0]);
      if (!dom || !(dom instanceof HTMLElement)) {
        setPos(null);
        return;
      }
      const rect = dom.getBoundingClientRect();
      // Bottom of toolbar (before translate -100% Y) sits at this viewport Y; keep on-screen when table is near the top.
      const top = Math.max(48, rect.top - GAP_PX);
      setPos({
        top,
        left: rect.left + rect.width / 2,
      });
    } catch {
      setPos(null);
    }
  }, [visible, editor, tablePathKey]);

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
  };

  if (!visible || !pos) return null;

  return (
    <Box
      position="fixed"
      zIndex={35}
      top={`${pos.top}px`}
      left={`${pos.left}px`}
      transform="translate(-50%, -100%)"
      pointerEvents="auto"
      onMouseDown={(e) => e.preventDefault()}
    >
      <HStack
        gap={0}
        px={1}
        py={0.5}
        borderRadius="md"
        borderWidth="1px"
        borderColor={{ _light: "blackAlpha.200", _dark: "whiteAlpha.200" }}
        bg={{ _light: "white", _dark: "gray.800" }}
        boxShadow="md"
      >
        <TTip label="Merge cells">
          <IconButton
            aria-label="Merge cells"
            size="xs"
            variant="ghost"
            disabled={!merge.canMerge}
            {...chromeGhostIconProps}
            onClick={() => {
              run((ed: any) => ed.tf.table.merge());
            }}
          >
            <Combine size={14} />
          </IconButton>
        </TTip>
        <TTip label="Split cell">
          <IconButton
            aria-label="Split cell"
            size="xs"
            variant="ghost"
            disabled={!merge.canSplit}
            {...chromeGhostIconProps}
            onClick={() => {
              run((ed: any) => ed.tf.table.split());
            }}
          >
            <Ungroup size={14} />
          </IconButton>
        </TTip>

        <Separator orientation="vertical" h="18px" mx={0.5} />

        <TTip label="Insert row above">
          <IconButton
            aria-label="Insert row above"
            size="xs"
            variant="ghost"
            {...chromeGhostIconProps}
            onClick={() => {
              run((ed: any) => ed.tf.insert.tableRow({ before: true }));
            }}
          >
            <ArrowUp size={14} />
          </IconButton>
        </TTip>
        <TTip label="Insert row below">
          <IconButton
            aria-label="Insert row below"
            size="xs"
            variant="ghost"
            {...chromeGhostIconProps}
            onClick={() => {
              run((ed: any) => ed.tf.insert.tableRow());
            }}
          >
            <ArrowDown size={14} />
          </IconButton>
        </TTip>

        <Separator orientation="vertical" h="18px" mx={0.5} />

        <TTip label="Delete table">
          <IconButton
            aria-label="Delete table"
            size="xs"
            variant="ghost"
            colorPalette="red"
            {...chromeGhostIconProps}
            onClick={() => {
              run((ed: any) => ed.tf.remove.table());
            }}
          >
            <Trash2 size={14} />
          </IconButton>
        </TTip>
      </HStack>
    </Box>
  );
}
