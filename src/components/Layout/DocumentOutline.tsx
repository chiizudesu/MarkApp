import { Box, IconButton, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OutlineNode } from "@/services/sectionService";

function OutlineTitle({ markdown }: { markdown: string }) {
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
}

function OutlineItems(props: {
  nodes: OutlineNode[];
  depth: number;
  activeFrom: number | null;
  onPick: (from: number, title: string) => void;
  onAddToChat: (from: number, title: string) => void;
}) {
  return (
    <>
      {props.nodes.map((n) => (
        <Box key={n.id}>
          <HStackRow
            title={n.title}
            depth={props.depth}
            active={props.activeFrom === n.from}
            onPick={() => props.onPick(n.from, n.title)}
            onAddToChat={() => props.onAddToChat(n.from, n.title)}
          />
          {n.children.length > 0 && (
            <OutlineItems
              nodes={n.children}
              depth={props.depth + 1}
              activeFrom={props.activeFrom}
              onPick={props.onPick}
              onAddToChat={props.onAddToChat}
            />
          )}
        </Box>
      ))}
    </>
  );
}

function HStackRow(props: {
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
      bg={props.active ? { _light: "blue.50", _dark: "blue.900" } : undefined}
      borderRadius="sm"
      cursor="pointer"
      onClick={props.onPick}
      _hover={{ bg: { _light: "blackAlpha.50", _dark: "whiteAlpha.50" } }}
    >
      <Text fontSize="xs" truncate flex="1" title={props.title} lineHeight="short">
        <OutlineTitle markdown={props.title} />
      </Text>
      <IconButton
        aria-label={`Add “${props.title}” to chat context`}
        size="xs"
        variant="ghost"
        colorPalette="blue"
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
}

export function DocumentOutline(props: {
  tree: OutlineNode[];
  activeFrom: number | null;
  onPick: (from: number, title: string) => void;
  onAddToChat: (from: number, title: string) => void;
}) {
  if (props.tree.length === 0) {
    return (
      <Text fontSize="xs" color="fg.muted" px={3} py={2}>
        No headings
      </Text>
    );
  }
  return (
    <VStack
      align="stretch"
      gap={0}
      maxH="200px"
      overflowY="auto"
      borderBottomWidth="1px"
      borderColor={{ _light: "blackAlpha.80", _dark: "whiteAlpha.60" }}
      py={2}
    >
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted" px={3} mb={1} letterSpacing="tight">
        Outline
      </Text>
      <OutlineItems
        nodes={props.tree}
        depth={0}
        activeFrom={props.activeFrom}
        onPick={props.onPick}
        onAddToChat={props.onAddToChat}
      />
    </VStack>
  );
}
