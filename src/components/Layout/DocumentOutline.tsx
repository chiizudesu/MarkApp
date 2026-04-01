import { memo, useState } from "react";
import { Box, IconButton, Text, VStack, HStack } from "@chakra-ui/react";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OutlineNode } from "@/services/sectionService";

/** Inline markdown in a heading title is rare; avoid react-markdown per row when plain text. */
function outlineTitleLooksPlain(s: string): boolean {
  return !/[*_`[\]\\]/.test(s);
}

const OutlineTitleMarkdown = memo(function OutlineTitleMarkdown({ markdown }: { markdown: string }) {
  return (
    <Box
      as="span"
      display="inline"
      className="md-prose md-prose-outline"
      fontSize="inherit"
      lineHeight="inherit"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <span>{children}</span>,
          h1: ({ children }) => <span>{children}</span>,
          h2: ({ children }) => <span>{children}</span>,
          h3: ({ children }) => <span>{children}</span>,
          h4: ({ children }) => <span>{children}</span>,
          h5: ({ children }) => <span>{children}</span>,
          h6: ({ children }) => <span>{children}</span>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </Box>
  );
});

function OutlineTitle({ title }: { title: string }) {
  if (outlineTitleLooksPlain(title)) {
    return (
      <Box as="span" fontSize="inherit" lineHeight="short">
        {title}
      </Box>
    );
  }
  return <OutlineTitleMarkdown markdown={title} />;
}

const HStackRow = memo(function HStackRow(props: {
  title: string;
  depth: number;
  active: boolean;
  onPick: () => void;
  onAddToChat: () => void;
}) {
  return (
    <Box
      pl={2 + props.depth * 12}
      pr={1}
      py={0.5}
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      gap={1}
      bg={
        props.active
          ? {
              _light: "rgba(167, 139, 250, 0.22)",
              _dark: "rgba(192, 181, 253, 0.12)",
            }
          : undefined
      }
      cursor="pointer"
      onClick={props.onPick}
      _hover={{ bg: { _light: "blackAlpha.50", _dark: "whiteAlpha.50" } }}
    >
      <Text fontSize="xs" truncate flex="1" title={props.title} lineHeight="short">
        <OutlineTitle title={props.title} />
      </Text>
      <IconButton
        aria-label={`Add “${props.title}” to chat context`}
        size="xs"
        variant="ghost"
        colorPalette="purple"
        flexShrink={0}
        minW="22px"
        h="22px"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          props.onAddToChat();
        }}
      >
        <Plus size={14} />
      </IconButton>
    </Box>
  );
});

function OutlineItems(props: {
  nodes: OutlineNode[];
  depth: number;
  activeSectionId: string | null;
  onPick: (node: OutlineNode) => void;
  onAddToChat: (node: OutlineNode) => void;
}) {
  return (
    <>
      {props.nodes.map((n) => (
        <HStackRow
          key={n.id}
          title={n.title}
          depth={0}
          active={props.activeSectionId !== null && props.activeSectionId === n.id}
          onPick={() => props.onPick(n)}
          onAddToChat={() => props.onAddToChat(n)}
        />
      ))}
    </>
  );
}

export const DocumentOutline = memo(function DocumentOutline(props: {
  tree: OutlineNode[];
  activeSectionId: string | null;
  onPick: (node: OutlineNode) => void;
  onAddToChat: (node: OutlineNode) => void;
}) {
  const [open, setOpen] = useState(true);

  if (props.tree.length === 0) {
    return (
      <Box
        flex="1"
        minH={0}
        display="flex"
        flexDirection="column"
        borderRightWidth="1px"
        borderColor={{ _light: "blackAlpha.80", _dark: "whiteAlpha.60" }}
        p={3}
      >
        <HStack py={1} justify="space-between" align="center">
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" letterSpacing="tight">
            Outline
          </Text>
          <IconButton
            aria-label={open ? "Collapse outline" : "Expand outline"}
            size="xs"
            variant="ghost"
            minW="24px"
            h="24px"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </IconButton>
        </HStack>
        {open ? (
          <Text fontSize="xs" color="fg.muted" py={1}>
            No headings
          </Text>
        ) : null}
      </Box>
    );
  }
  return (
    <VStack
      align="stretch"
      gap={0}
      flex="1"
      minH={0}
      overflow="hidden"
      borderRightWidth="1px"
      borderColor={{ _light: "blackAlpha.80", _dark: "whiteAlpha.60" }}
      p={3}
    >
      <HStack mb={1} justify="space-between" align="center">
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted" letterSpacing="tight">
          Outline
        </Text>
        <IconButton
          aria-label={open ? "Collapse outline" : "Expand outline"}
          size="xs"
          variant="ghost"
          minW="24px"
          h="24px"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>
      </HStack>
      {open ? (
        <VStack align="stretch" gap={0} flex="1" minH={0} overflowY="auto">
          <OutlineItems
            nodes={props.tree}
            depth={0}
            activeSectionId={props.activeSectionId}
            onPick={props.onPick}
            onAddToChat={props.onAddToChat}
          />
        </VStack>
      ) : null}
    </VStack>
  );
});
