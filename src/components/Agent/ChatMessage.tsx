import { Box, Text } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage as Msg } from "@/types/agent";
import { InlineTextDiff } from "./InlineTextDiff";
import { stripOuterMarkdownCodeFence } from "@/utils/markdownFence";

export function ChatMessageBubble({ message }: { message: Msg }) {
  const isUser = message.role === "user";
  const assistantMd = stripOuterMarkdownCodeFence(message.content);
  const proposal = message.sectionProposal;

  return (
    <Box
      alignSelf={isUser ? "flex-end" : "stretch"}
      maxW={isUser ? "min(92%, 380px)" : "100%"}
      px={3}
      py={2.5}
      borderRadius="2xl"
      borderWidth="1px"
      borderColor={
        isUser
          ? { _light: "blackAlpha.150", _dark: "whiteAlpha.100" }
          : { _light: "blackAlpha.100", _dark: "whiteAlpha.80" }
      }
      bg={
        isUser
          ? { _light: "gray.100", _dark: "#323234" }
          : { _light: "white", _dark: "#2a2a2c" }
      }
      fontSize="sm"
      lineHeight="1.55"
    >
      {isUser ? (
        <Text whiteSpace="pre-wrap" color="fg">
          {message.content}
        </Text>
      ) : (
        <Box fontSize="sm" color="fg">
          {proposal ? (
            <Box mb={3} pb={3} borderBottomWidth="1px" borderColor={{ _light: "blackAlpha.100", _dark: "whiteAlpha.100" }}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={1.5} letterSpacing="tight">
                Inline changes
              </Text>
              <InlineTextDiff oldText={proposal.oldText} newText={proposal.newText} />
            </Box>
          ) : null}
          <Box className="md-prose md-prose-chat">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{assistantMd}</ReactMarkdown>
          </Box>
        </Box>
      )}
    </Box>
  );
}
