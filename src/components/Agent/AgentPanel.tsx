import { Box, Flex } from "@chakra-ui/react";
import { ChatMessageBubble } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import type { ChatMessage, SectionRef } from "@/types/agent";
import {
  normalizeAssistantMarkdownParagraphs,
  stripStreamingOuterMarkdownCodeFence,
} from "@/utils/markdownFence";

export function AgentPanel(props: {
  messages: ChatMessage[];
  streamingText: string;
  /** When true, match finalized-message rules: stream as whole-document proposal even with 0 or many context sections */
  documentIsBlank: boolean;
  /** Current editor markdown — baseline for whole-doc streaming diff when no sections are pinned */
  documentMarkdown: string;
  contextSections: SectionRef[];
  onRemoveContext: (id: string) => void;
  onAddSection: (s: SectionRef) => void;
  allSections: SectionRef[];
  mentionDocument: boolean;
  mentionClipboard: boolean;
  onToggleDocument: (v: boolean) => void;
  onToggleClipboard: (v: boolean) => void;
  busy: boolean;
  onSend: (text: string) => void;
  onClosePanel: () => void;
  onClearChat: () => void;
  onAcceptProposal: (msgId: string) => void;
  onRevertProposal: (msgId: string) => void;
}) {
  const wholeDocNoPins =
    props.contextSections.length === 0 && !props.documentIsBlank;
  const streamingSectionProposal =
    props.streamingText &&
    (props.contextSections.length === 1 || props.documentIsBlank || wholeDocNoPins)
      ? {
          oldText: props.documentIsBlank
            ? ""
            : props.contextSections.length === 1
              ? props.contextSections[0].content
              : props.documentMarkdown,
          newText: normalizeAssistantMarkdownParagraphs(
            stripStreamingOuterMarkdownCodeFence(props.streamingText),
          ),
          sectionTitle:
            props.documentIsBlank
              ? "Document"
              : props.contextSections.length === 1
                ? props.contextSections[0].title
                : "Document",
        }
      : undefined;

  return (
    <Flex
      direction="column"
      h="full"
      w="full"
      minW="0"
      borderLeftWidth="1px"
      borderColor={{ _light: "blackAlpha.100", _dark: "whiteAlpha.100" }}
      bg={{ _light: "gray.50", _dark: "#1e1e1e" }}
    >
      <Flex direction="column" flex="1" minH={0}>
        <Box
          flex="1"
          overflowY="auto"
          px={3}
          py={3}
          display="flex"
          flexDirection="column"
          gap={3}
          css={{
            scrollbarGutter: "stable",
          }}
        >
          {props.messages.map((m) => (
            <ChatMessageBubble
              key={m.id}
              message={m}
              onAccept={props.onAcceptProposal}
              onRevert={props.onRevertProposal}
            />
          ))}
          {props.streamingText ? (
            <ChatMessageBubble
              message={{
                id: "stream",
                role: "assistant",
                content: props.streamingText,
                sectionProposal: streamingSectionProposal,
              }}
            />
          ) : null}
        </Box>
        <ChatInput
          contextSections={props.contextSections}
          onRemoveContext={props.onRemoveContext}
          allSectionsForMentions={props.allSections}
          mentionDocument={props.mentionDocument}
          mentionClipboard={props.mentionClipboard}
          onToggleDocument={props.onToggleDocument}
          onToggleClipboard={props.onToggleClipboard}
          onAddSectionFromMention={props.onAddSection}
          disabled={props.busy}
          busy={props.busy}
          onSend={props.onSend}
          onClearChat={props.onClearChat}
        />
      </Flex>
    </Flex>
  );
}
