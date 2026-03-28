import { Box, IconButton, HStack } from "@chakra-ui/react";
import { Bold, Italic, Underline, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered, Code, Quote, Minus } from "lucide-react";
import type { PlateEditorHandle } from "./PlateEditor";

export function EditorToolbar({ editorRef }: { editorRef: React.RefObject<PlateEditorHandle | null> }) {
  const run = (fn: (editor: any) => void) => {
    const editor = editorRef.current?.getEditor();
    if (editor) fn(editor);
  };

  return (
    <Box borderBottomWidth="1px" px={2} py={1} bg="bg.muted">
      <HStack gap={0} flexWrap="wrap">
        <IconButton
          aria-label="Bold"
          size="sm"
          variant="ghost"
          onClick={() => run((e) => e.tf.bold.toggle())}
        >
          <Bold size={16} />
        </IconButton>
        <IconButton
          aria-label="Italic"
          size="sm"
          variant="ghost"
          onClick={() => run((e) => e.tf.italic.toggle())}
        >
          <Italic size={16} />
        </IconButton>
        <IconButton
          aria-label="Underline"
          size="sm"
          variant="ghost"
          onClick={() => run((e) => e.tf.underline.toggle())}
        >
          <Underline size={16} />
        </IconButton>
        <IconButton
          aria-label="Strikethrough"
          size="sm"
          variant="ghost"
          onClick={() => run((e) => e.tf.strikethrough.toggle())}
        >
          <Strikethrough size={16} />
        </IconButton>

        <Box w="1px" h="20px" bg="gray.300" mx={1} />

        <IconButton
          aria-label="Heading 1"
          size="sm"
          variant="ghost"
          onClick={() => run((e) => e.tf.h1.toggle())}
        >
          <Heading1 size={16} />
        </IconButton>
        <IconButton
          aria-label="Heading 2"
          size="sm"
          variant="ghost"
          onClick={() => run((e) => e.tf.h2.toggle())}
        >
          <Heading2 size={16} />
        </IconButton>
        <IconButton
          aria-label="Heading 3"
          size="sm"
          variant="ghost"
          onClick={() => run((e) => e.tf.h3.toggle())}
        >
          <Heading3 size={16} />
        </IconButton>

        <Box w="1px" h="20px" bg="gray.300" mx={1} />

        <IconButton
          aria-label="Blockquote"
          size="sm"
          variant="ghost"
          onClick={() => run((e) => e.tf.blockquote.toggle())}
        >
          <Quote size={16} />
        </IconButton>
        <IconButton
          aria-label="Inline code"
          size="sm"
          variant="ghost"
          onClick={() => run((e) => e.tf.code.toggle())}
        >
          <Code size={16} />
        </IconButton>

        <Box w="1px" h="20px" bg="gray.300" mx={1} />

        <IconButton
          aria-label="Bullet list"
          size="sm"
          variant="ghost"
          onClick={() =>
            run((e) => {
              try {
                e.tf.list?.toggle?.({ listStyleType: "disc" });
              } catch {
                // list plugin may not expose toggle directly
              }
            })
          }
        >
          <List size={16} />
        </IconButton>
        <IconButton
          aria-label="Numbered list"
          size="sm"
          variant="ghost"
          onClick={() =>
            run((e) => {
              try {
                e.tf.list?.toggle?.({ listStyleType: "decimal" });
              } catch {
                // list plugin may not expose toggle directly
              }
            })
          }
        >
          <ListOrdered size={16} />
        </IconButton>
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
      </HStack>
    </Box>
  );
}
