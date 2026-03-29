import { Box, Flex, Text, Spinner, List } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage as Msg } from "@/types/agent";
import { SectionInlineDiffPreview } from "./SectionInlineDiffPreview";
import { stripOuterMarkdownCodeFence } from "@/utils/markdownFence";

function lineCount(text: string) {
  return text ? text.split(/\r?\n/).length : 0;
}

export function ChatMessageBubble({ message }: { message: Msg }) {
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

  // Assistant with diff proposal: preview + summary, no bubble
  if (proposal) {
    const removed = lineCount(proposal.oldText);
    const added = lineCount(proposal.newText);
    const title = proposal.sectionTitle?.trim() || "section";
    const hasSummary = proposal.summary && proposal.summary.length > 0;
    // summary is undefined while loading, [] means done but empty
    const summaryLoading = proposal.summary === undefined;

    return (
      <Box display="flex" flexDirection="column" gap={1.5}>
        <SectionInlineDiffPreview
          title={title}
          oldText={proposal.oldText}
          newText={proposal.newText}
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
      </Box>
    );
  }

  // Assistant plain text: no bubble, just prose
  return (
    <Box
      fontSize="sm"
      lineHeight="1.55"
      color="fg"
      className="md-prose md-prose-chat"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {stripOuterMarkdownCodeFence(message.content)}
      </ReactMarkdown>
    </Box>
  );
}
