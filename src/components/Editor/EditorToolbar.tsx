import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Box, IconButton, HStack, Separator, Tooltip } from "@chakra-ui/react";
import { ListStyleType, someList, toggleList } from "@platejs/list";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Code,
  FileCode2,
  Quote,
  Minus,
  PanelRight,
  Highlighter,
} from "lucide-react";
import { Editor } from "slate";
import type { PlateEditorHandle } from "./PlateEditor";
import { modShortcut } from "@/utils/platform";

function TBarTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content px={2} py={1} fontSize="xs" maxW="240px">
          {label}
        </Tooltip.Content>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

type FmtState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  block?: string;
  bulletList: boolean;
  numberedList: boolean;
};

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
  const [fmt, setFmt] = useState<FmtState>({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    code: false,
    block: undefined,
    bulletList: false,
    numberedList: false,
  });

  const tick = useCallback(() => {
    const editor = editorRef.current?.getEditor() as any;
    if (!editor?.selection) return;
    try {
      const marks = (Editor.marks(editor) ?? {}) as Record<string, unknown>;
      const block = editor.api?.block?.({ highest: true });
      const blockType = block?.[0]?.type as string | undefined;
      setFmt({
        bold: !!marks["bold"],
        italic: !!marks["italic"],
        underline: !!marks["underline"],
        strikethrough: !!marks["strikethrough"],
        code: !!marks["code"],
        block: blockType,
        bulletList: someList(editor, ListStyleType.Disc),
        numberedList: someList(editor, ListStyleType.Decimal),
      });
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
    active ? { bg: { _light: "blue.50", _dark: "rgba(59, 130, 246, 0.22)" }, color: { _light: "blue.700", _dark: "blue.200" } } : {};

  return (
    <Box borderBottomWidth="1px" px={2} py={1} bg="bg.muted">
      <HStack gap={0} flexWrap="wrap" align="center" justify="space-between">
        <HStack gap={0} flexWrap="wrap" align="center">
        <TBarTip label={`Bold (${modShortcut("B")})`}>
          <IconButton
            aria-label="Bold"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => e.tf.bold.toggle())}
            {...markBtn(fmt.bold)}
          >
            <Bold size={16} />
          </IconButton>
        </TBarTip>
        <TBarTip label={`Italic (${modShortcut("I")})`}>
          <IconButton
            aria-label="Italic"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => e.tf.italic.toggle())}
            {...markBtn(fmt.italic)}
          >
            <Italic size={16} />
          </IconButton>
        </TBarTip>
        <TBarTip label={`Underline (${modShortcut("U")})`}>
          <IconButton
            aria-label="Underline"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => e.tf.underline.toggle())}
            {...markBtn(fmt.underline)}
          >
            <Underline size={16} />
          </IconButton>
        </TBarTip>
        <TBarTip label="Strikethrough">
          <IconButton
            aria-label="Strikethrough"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => e.tf.strikethrough.toggle())}
            {...markBtn(fmt.strikethrough)}
          >
            <Strikethrough size={16} />
          </IconButton>
        </TBarTip>

        <Separator orientation="vertical" h="20px" mx={1} />

        <TextLabel aria-hidden>Headings</TextLabel>
        <TBarTip label="Heading 1">
          <IconButton
            aria-label="Heading 1"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => e.tf.h1.toggle())}
            {...markBtn(fmt.block === "h1")}
          >
            <Heading1 size={16} />
          </IconButton>
        </TBarTip>
        <TBarTip label="Heading 2">
          <IconButton
            aria-label="Heading 2"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => e.tf.h2.toggle())}
            {...markBtn(fmt.block === "h2")}
          >
            <Heading2 size={16} />
          </IconButton>
        </TBarTip>
        <TBarTip label="Heading 3">
          <IconButton
            aria-label="Heading 3"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => e.tf.h3.toggle())}
            {...markBtn(fmt.block === "h3")}
          >
            <Heading3 size={16} />
          </IconButton>
        </TBarTip>

        <Separator orientation="vertical" h="20px" mx={1} />

        <TBarTip label="Blockquote">
          <IconButton
            aria-label="Blockquote"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => e.tf.blockquote.toggle())}
            {...markBtn(fmt.block === "blockquote")}
          >
            <Quote size={16} />
          </IconButton>
        </TBarTip>
        <TBarTip label="Inline code">
          <IconButton
            aria-label="Inline code"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => e.tf.code.toggle())}
            {...markBtn(fmt.code)}
          >
            <Code size={16} />
          </IconButton>
        </TBarTip>
        <TBarTip label="Code block (Mod+Alt+8)">
          <IconButton
            aria-label="Code block"
            size="sm"
            variant="ghost"
            onClick={() =>
              run((e) => {
                const tf = (e as any).tf;
                tf.code_block?.toggle?.();
              })
            }
            {...markBtn(fmt.block === "code_block")}
          >
            <FileCode2 size={16} />
          </IconButton>
        </TBarTip>

        <Separator orientation="vertical" h="20px" mx={1} />

        <TBarTip label="Bullet list">
          <IconButton
            aria-label="Bullet list"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => toggleList(e, { listStyleType: ListStyleType.Disc }))}
            {...markBtn(fmt.bulletList)}
          >
            <List size={16} />
          </IconButton>
        </TBarTip>
        <TBarTip label="Numbered list">
          <IconButton
            aria-label="Numbered list"
            size="sm"
            variant="ghost"
            onClick={() => run((e) => toggleList(e, { listStyleType: ListStyleType.Decimal }))}
            {...markBtn(fmt.numberedList)}
          >
            <ListOrdered size={16} />
          </IconButton>
        </TBarTip>
        <TBarTip label="Horizontal rule">
          <IconButton
            aria-label="Horizontal rule"
            size="sm"
            variant="ghost"
            onClick={() =>
              run((e) => {
                e.tf.insertNodes({ type: "hr", children: [{ text: "" }] });
                e.tf.insertNodes({ type: "p", children: [{ text: "" }] });
              })
            }
          >
            <Minus size={16} />
          </IconButton>
        </TBarTip>
        </HStack>
        <HStack gap={1} flexShrink={0}>
          <TBarTip
            label={
              sectionHoverHighlight
                ? "Section hover highlight on — click to hide outline & + button"
                : "Section hover highlight off — click to show on hover"
            }
          >
            <IconButton
              aria-label={
                sectionHoverHighlight
                  ? "Turn off section hover highlight"
                  : "Turn on section hover highlight"
              }
              size="xs"
              variant={sectionHoverHighlight ? "subtle" : "ghost"}
              colorPalette="purple"
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

function TextLabel(props: { children: ReactNode; "aria-hidden"?: boolean }) {
  return (
    <Box
      as="span"
      fontSize="10px"
      fontWeight="medium"
      color="fg.muted"
      textTransform="uppercase"
      letterSpacing="wider"
      px={1}
      display={{ base: "none", lg: "inline" }}
      aria-hidden={props["aria-hidden"]}
    >
      {props.children}
    </Box>
  );
}
