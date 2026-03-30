import { Box, Flex, Text, Spinner, List, IconButton, HStack } from "@chakra-ui/react";
import { Check, Undo2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useColorMode } from "@/components/ui/color-mode";
import type { ChatMessage as Msg } from "@/types/agent";
import { SectionInlineDiffPreview } from "./SectionInlineDiffPreview";
import { stripOuterMarkdownCodeFence } from "@/utils/markdownFence";

function lineCount(text: string) {
  return text ? text.split(/\r?\n/).length : 0;
}

export function ChatMessageBubble({
  message,
  onAccept,
  onRevert,
}: {
  message: Msg;
  onAccept?: (msgId: string) => void;
  onRevert?: (msgId: string) => void;
}) {
  const { colorMode } = useColorMode();
  const markappSurface = colorMode === "dark" ? "markapp-dark" : "markapp-light";
  const isUser = message.role === "user";
  const proposal = message.sectionProposal;

  // User messages: bubble only
  if (isUser) {
    return (
      <Box
        alignSelf="flex-end"
        maxW="min(92%, 380px)"
        px={3}
        py={2.5}
        borderRadius="2xl"
        borderWidth="1px"
        borderColor={{ _light: "blackAlpha.150", _dark: "whiteAlpha.100" }}
        bg={{ _light: "gray.100", _dark: "#323234" }}
        fontSize="sm"
        lineHeight="1.55"
      >
        <Text whiteSpace="pre-wrap" color="fg">
          {message.content}
        </Text>
      </Box>
    );
  }

  // Assistant with diff proposal: preview + summary + accept/revert controls
  if (proposal) {
    const isStreaming = message.id === "stream";
    const removed = lineCount(proposal.oldText);
    const added = lineCount(proposal.newText);
    const title = proposal.sectionTitle?.trim() || "section";
    const hasSummary = proposal.summary && proposal.summary.length > 0;
    const summaryLoading = !isStreaming && proposal.summary === undefined;
    const isDecided = proposal.accepted !== undefined;

    return (
      <Box display="flex" flexDirection="column" gap={1.5}>
        <SectionInlineDiffPreview
          title={title}
          oldText={proposal.oldText}
          newText={proposal.newText}
          isGenerating={isStreaming}
        />

        {/* Line-count footer */}
        <Text
          fontSize="11px"
          color={{ _light: "gray.500", _dark: "gray.400" }}
          px={0.5}
        >
          Rewrote{" "}
          <Text as="strong" fontWeight="medium" color={{ _light: "gray.600", _dark: "gray.300" }}>
            {title}
          </Text>
          {" "}— {removed} line{removed !== 1 ? "s" : ""} → {added} line{added !== 1 ? "s" : ""}
        </Text>

        {/* AI summary bullets */}
        {summaryLoading ? (
          <Flex align="center" gap={1.5} px={0.5} pt={0.5}>
            <Spinner size="xs" color="blue.400" />
            <Text fontSize="11px" color={{ _light: "gray.400", _dark: "gray.500" }}>
              Summarising changes…
            </Text>
          </Flex>
        ) : hasSummary ? (
          <List.Root
            variant="plain"
            gap={0.5}
            px={0.5}
            fontSize="11px"
            color={{ _light: "gray.600", _dark: "gray.400" }}
          >
            {proposal.summary!.map((point, i) => (
              <List.Item key={i} display="flex" alignItems="flex-start" gap={1.5}>
                <Text as="span" color="blue.400" lineHeight="1.5" flexShrink={0}>•</Text>
                <Text as="span" lineHeight="1.5">{point}</Text>
              </List.Item>
            ))}
          </List.Root>
        ) : null}

        {/* Accept / Revert controls */}
        {isStreaming ? (
          <Text fontSize="10px" color="fg.muted" px={0.5}>
            Receiving…
          </Text>
        ) : isDecided ? (
          <Text
            fontSize="11px"
            color={
              proposal.accepted
                ? { _light: "green.600", _dark: "green.400" }
                : { _light: "gray.400", _dark: "gray.500" }
            }
            px={0.5}
          >
            {proposal.accepted ? "✓ Accepted" : "↩ Reverted"}
          </Text>
        ) : (
          <HStack gap={1.5} px={0.5}>
            <IconButton
              aria-label="Accept changes"
              size="xs"
              variant="subtle"
              colorPalette="green"
              borderRadius="md"
              h="22px"
              minW="22px"
              onClick={() => onAccept?.(message.id)}
            >
              <Check size={12} strokeWidth={2.5} />
            </IconButton>
            <IconButton
              aria-label="Revert changes"
              size="xs"
              variant="subtle"
              colorPalette="orange"
              borderRadius="md"
              h="22px"
              minW="22px"
              onClick={() => onRevert?.(message.id)}
            >
              <Undo2 size={12} strokeWidth={2} />
            </IconButton>
            <Text fontSize="10px" color="fg.muted">
              Accept or revert
            </Text>
          </HStack>
        )}
      </Box>
    );
  }

  // Assistant plain text: no bubble, just prose
  return (
    <Box
      fontSize="sm"
      lineHeight="1.55"
      color="fg"
      className={`md-prose md-prose-chat ${markappSurface}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {stripOuterMarkdownCodeFence(message.content)}
      </ReactMarkdown>
    </Box>
  );
}
