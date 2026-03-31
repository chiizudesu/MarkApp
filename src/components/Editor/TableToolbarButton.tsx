import { useEffect, useReducer, useState, type RefObject } from "react";
import { Box, IconButton, Menu, Separator, Text } from "@chakra-ui/react";
import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Combine,
  Grid3x3,
  Table,
  Trash2,
  Ungroup,
} from "lucide-react";

import type { PlateEditorHandle } from "./PlateEditor";
import { chromeGhostIconProps } from "@/components/ui/quietFocusRing";
import { tableToolbarMergeState } from "./tableToolbarMergeState";

const PICKER_SIZE = 8;

function TableSizePicker({
  onInsert,
  onClose,
}: {
  onInsert: (rowCount: number, colCount: number) => void;
  onClose: () => void;
}) {
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  const rowCount = hover ? hover.row + 1 : 0;
  const colCount = hover ? hover.col + 1 : 0;

  return (
    <Box px={2} pt={1} pb={2}>
      <Text fontSize="10px" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider" mb={1.5}>
        Insert table
      </Text>
      <Box
        display="grid"
        gridTemplateColumns={`repeat(${PICKER_SIZE}, 12px)`}
        gap="3px"
        w="fit-content"
        onMouseLeave={() => setHover(null)}
        role="grid"
        aria-label="Table size"
      >
        {Array.from({ length: PICKER_SIZE }, (_, r) =>
          Array.from({ length: PICKER_SIZE }, (_, c) => {
            const active = hover !== null && r <= hover.row && c <= hover.col;
            return (
              <Box
                key={`${r}-${c}`}
                role="gridcell"
                w="12px"
                h="12px"
                borderRadius="2px"
                borderWidth="1px"
                borderColor={active ? "blue.500" : "border"}
                bg={active ? { _light: "blue.100", _dark: "rgba(59, 130, 246, 0.25)" } : { _light: "gray.100", _dark: "whiteAlpha.100" }}
                cursor="pointer"
                onMouseEnter={() => setHover({ row: r, col: c })}
                onClick={() => {
                  if (rowCount < 1 || colCount < 1) return;
                  onInsert(rowCount, colCount);
                  onClose();
                }}
              />
            );
          }),
        )}
      </Box>
      <Text fontSize="11px" color="fg.muted" mt={1.5} textAlign="center">
        {rowCount > 0 && colCount > 0 ? `${rowCount} × ${colCount}` : "Hover to choose size"}
      </Text>
    </Box>
  );
}

const menuContentStyle = {
  borderRadius: "lg",
  boxShadow: "lg",
  py: 1,
  minW: "0",
  maxH: "min(70vh, 420px)",
  overflowY: "auto" as const,
};

/**
 * Chakra port of Plate’s {@link https://platejs.org/docs/components/table-toolbar-button TableToolbarButton}
 * (grid insert + merge / split / row / column / delete). Plate UI uses Radix + shadcn; we keep the same transforms.
 */
export function TableToolbarButton({
  editorRef,
  onAfterCommand,
}: {
  editorRef: RefObject<PlateEditorHandle | null>;
  onAfterCommand?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => bump(), 160);
    return () => window.clearInterval(id);
  }, [open]);

  const editor = editorRef.current?.getEditor() as PlateEditor | undefined;
  const inTable = editor?.api.some({ match: { type: KEYS.table } }) ?? false;
  const merge = editor ? tableToolbarMergeState(editor, false) : { canMerge: false, canSplit: false };

  /** Plugin transforms (`tf.insert.table`, `tf.table.merge`, …) are not on the public `tf` typedef. */
  const run = (fn: (ed: any) => void) => {
    const ed = editorRef.current?.getEditor();
    if (!ed) return;
    fn(ed);
    ed.tf.focus();
    onAfterCommand?.();
  };

  return (
    <Menu.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Menu.Trigger asChild>
        <IconButton aria-label="Table" size="sm" variant="ghost" {...chromeGhostIconProps} data-active={open ? "" : undefined}>
          <Table size={14} />
        </IconButton>
      </Menu.Trigger>
      <Menu.Positioner>
        <Menu.Content {...menuContentStyle} minW="200px">
          <TableSizePicker
            onClose={() => setOpen(false)}
            onInsert={(rowCount, colCount) => {
              run((ed) => {
                ed.tf.insert.table({ rowCount, colCount }, { select: true });
              });
            }}
          />

          {inTable ? (
            <>
              <Separator />
              <Box px={2} py={1}>
                <Text fontSize="10px" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider" mb={1}>
                  Cells
                </Text>
                <Menu.Item
                  value="merge"
                  disabled={!merge.canMerge}
                  onSelect={() => {
                    run((ed) => {
                      ed.tf.table.merge();
                    });
                    setOpen(false);
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <Combine size={14} />
                    <Text fontSize="12px">Merge cells</Text>
                  </Box>
                </Menu.Item>
                <Menu.Item
                  value="split"
                  disabled={!merge.canSplit}
                  onSelect={() => {
                    run((ed) => {
                      ed.tf.table.split();
                    });
                    setOpen(false);
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <Ungroup size={14} />
                    <Text fontSize="12px">Split cell</Text>
                  </Box>
                </Menu.Item>
              </Box>

              <Separator />
              <Box px={2} py={1}>
                <Text fontSize="10px" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider" mb={1}>
                  Row
                </Text>
                <Menu.Item
                  value="row-before"
                  onSelect={() => {
                    run((ed) => ed.tf.insert.tableRow({ before: true }));
                    setOpen(false);
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <ArrowUp size={14} />
                    <Text fontSize="12px">Insert row before</Text>
                  </Box>
                </Menu.Item>
                <Menu.Item
                  value="row-after"
                  onSelect={() => {
                    run((ed) => ed.tf.insert.tableRow());
                    setOpen(false);
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <ArrowDown size={14} />
                    <Text fontSize="12px">Insert row after</Text>
                  </Box>
                </Menu.Item>
                <Menu.Item
                  value="row-del"
                  onSelect={() => {
                    run((ed) => ed.tf.remove.tableRow());
                    setOpen(false);
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <Trash2 size={14} />
                    <Text fontSize="12px">Delete row</Text>
                  </Box>
                </Menu.Item>
              </Box>

              <Separator />
              <Box px={2} py={1}>
                <Text fontSize="10px" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider" mb={1}>
                  Column
                </Text>
                <Menu.Item
                  value="col-before"
                  onSelect={() => {
                    run((ed) => ed.tf.insert.tableColumn({ before: true }));
                    setOpen(false);
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <ArrowLeft size={14} />
                    <Text fontSize="12px">Insert column before</Text>
                  </Box>
                </Menu.Item>
                <Menu.Item
                  value="col-after"
                  onSelect={() => {
                    run((ed) => ed.tf.insert.tableColumn());
                    setOpen(false);
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <ArrowRight size={14} />
                    <Text fontSize="12px">Insert column after</Text>
                  </Box>
                </Menu.Item>
                <Menu.Item
                  value="col-del"
                  onSelect={() => {
                    run((ed) => ed.tf.remove.tableColumn());
                    setOpen(false);
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <Trash2 size={14} />
                    <Text fontSize="12px">Delete column</Text>
                  </Box>
                </Menu.Item>
              </Box>

              <Separator />
              <Box px={2} py={1}>
                <Menu.Item
                  value="del-table"
                  onSelect={() => {
                    run((ed) => ed.tf.remove.table());
                    setOpen(false);
                  }}
                >
                  <Box display="flex" alignItems="center" gap={2}>
                    <Grid3x3 size={14} />
                    <Text fontSize="12px">Delete table</Text>
                  </Box>
                </Menu.Item>
              </Box>
            </>
          ) : null}
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}
