import { useRef, useState, useMemo } from "react";
import { Box, Flex, Textarea, HStack, Text, IconButton, Spinner } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, Send, Trash2 } from "lucide-react";
import { SectionPill } from "./SectionPill";
import { MentionDropdown, type MentionOption } from "./MentionDropdown";
import type { SectionRef } from "@/types/agent";

export function ChatInput(props: {
  contextSections: SectionRef[];
  onRemoveContext: (id: string) => void;
  allSectionsForMentions: SectionRef[];
  mentionDocument: boolean;
  mentionClipboard: boolean;
  onToggleDocument: (v: boolean) => void;
  onToggleClipboard: (v: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  onSend: (text: string) => void;
  onAddSectionFromMention: (section: SectionRef) => void;
  onClearChat: () => void;
}) {
  const [text, setText] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [pillsExpanded, setPillsExpanded] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  const mentionOptions = useMemo((): MentionOption[] => {
    const opts: MentionOption[] = [];
    if (!props.mentionDocument) opts.push({ type: "document" });
    if (!props.mentionClipboard) opts.push({ type: "clipboard" });
    for (const s of props.allSectionsForMentions) {
      if (!props.contextSections.some((c) => c.id === s.id)) {
        opts.push({ type: "section", section: s });
      }
    }
    return opts;
  }, [
    props.allSectionsForMentions,
    props.contextSections,
    props.mentionDocument,
    props.mentionClipboard,
  ]);

  const contextCount = useMemo(
    () =>
      props.contextSections.length +
      (props.mentionDocument ? 1 : 0) +
      (props.mentionClipboard ? 1 : 0),
    [props.contextSections, props.mentionDocument, props.mentionClipboard],
  );

  const hasContextPills =
    props.contextSections.length > 0 || props.mentionDocument || props.mentionClipboard;

  const allPills = useMemo(() => {
    const pills: { id: string; label: string; onRemove: () => void }[] = [];
    for (const s of props.contextSections) {
      pills.push({ id: s.id, label: s.title, onRemove: () => props.onRemoveContext(s.id) });
    }
    if (props.mentionDocument) {
      pills.push({ id: "__doc__", label: "Full document", onRemove: () => props.onToggleDocument(false) });
    }
    if (props.mentionClipboard) {
      pills.push({ id: "__clip__", label: "Clipboard", onRemove: () => props.onToggleClipboard(false) });
    }
    return pills;
  }, [props.contextSections, props.mentionDocument, props.mentionClipboard]);

  const pickMention = (o: MentionOption) => {
    if (o.type === "document") props.onToggleDocument(true);
    else if (o.type === "clipboard") props.onToggleClipboard(true);
    else props.onAddSectionFromMention(o.section);
    setMentionOpen(false);
    setText((t) => t.replace(/@([\w]*)$/, ""));
  };

  const send = () => {
    const t = text.trim();
    if (!t || props.disabled) return;
    props.onSend(t);
    setText("");
    setMentionOpen(false);
  };

  return (
    <Box position="relative" px={2.5} pb={2} pt={1.5} flexShrink={0}>
      {mentionOpen && (
        <MentionDropdown
          options={mentionOptions}
          onPick={pickMention}
          onClose={() => setMentionOpen(false)}
        />
      )}
      <Box
        borderRadius="xl"
        borderWidth="1px"
        borderColor={{ _light: "blackAlpha.200", _dark: "whiteAlpha.150" }}
        bg={{ _light: "gray.50", _dark: "#2a2a2c" }}
        boxShadow={{ _light: "sm", _dark: "0 0 0 1px rgba(255,255,255,0.04)" }}
        px={2.5}
        py={1.5}
      >
        {hasContextPills && (
          <Box
            mb={1.5}
            borderBottomWidth="1px"
            borderColor={{ _light: "blackAlpha.80", _dark: "whiteAlpha.80" }}
            pb={1.5}
          >
            <Flex align="center" gap={1} minW={0}>
              {/* Pills zone — single line (clipped) or wrapped */}
              <Box
                flex={1}
                minW={0}
                overflow={pillsExpanded ? "visible" : "hidden"}
              >
                <Flex
                  gap={1}
                  flexWrap={pillsExpanded ? "wrap" : "nowrap"}
                  align="center"
                >
                  {allPills.map((p) => (
                    <SectionPill
                      key={p.id}
                      section={{
                        id: p.id,
                        title: p.label,
                        content: "",
                        from: 0,
                        to: 0,
                      }}
                      onRemove={p.onRemove}
                    />
                  ))}
                </Flex>
              </Box>

              {/* Right: count + expand/collapse toggle */}
              <HStack gap={0.5} flexShrink={0} align="center">
                <Text
                  fontSize="10px"
                  fontWeight="medium"
                  color={{ _light: "gray.500", _dark: "gray.400" }}
                  whiteSpace="nowrap"
                >
                  {contextCount} {contextCount === 1 ? "item" : "items"}
                </Text>
                <IconButton
                  aria-label={pillsExpanded ? "Collapse context" : "Expand context"}
                  size="xs"
                  variant="ghost"
                  minW="20px"
                  h="20px"
                  color="fg.muted"
                  onClick={() => setPillsExpanded((v) => !v)}
                >
                  {pillsExpanded
                    ? <ChevronUp size={12} strokeWidth={2} />
                    : <ChevronDown size={12} strokeWidth={2} />
                  }
                </IconButton>
              </HStack>
            </Flex>
          </Box>
        )}

        <Textarea
          ref={ta}
          focusRing="none"
          focusVisibleRing="none"
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (/@([\w]*)$/.test(v)) setMentionOpen(true);
            else setMentionOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask Claude… (@ for context)"
          minH="38px"
          maxH="120px"
          disabled={props.disabled}
          resize="none"
          unstyled
          color="fg"
          fontSize="sm"
          lineHeight="1.45"
          css={{
            width: "100%",
            background: "transparent",
            _placeholder: { color: "var(--chakra-colors-fg-muted)" },
          }}
        />

        <HStack
          justify="space-between"
          align="center"
          gap={0}
          mt={1}
          pt={1.5}
          borderTopWidth="1px"
          borderColor="border.muted"
          minH="22px"
        >
          <HStack gap={0}>
            <IconButton
              aria-label="Clear chat"
              size="xs"
              variant="ghost"
              minW="20px"
              h="20px"
              disabled={props.busy}
              onClick={props.onClearChat}
            >
              <Trash2 size={12} strokeWidth={1.75} />
            </IconButton>
          </HStack>
          <HStack gap={1.5} align="center">
            {props.busy && <Spinner size="xs" color="fg.muted" />}
            <IconButton
              aria-label="Send"
              size="xs"
              variant="ghost"
              borderRadius="md"
              minW="20px"
              h="20px"
              disabled={props.disabled || !text.trim()}
              onClick={send}
              color="fg.muted"
              _hover={{ color: "fg", bg: "transparent" }}
              _disabled={{ opacity: 0.3 }}
            >
              <Send size={12} strokeWidth={1.75} />
            </IconButton>
          </HStack>
        </HStack>
      </Box>
    </Box>
  );
}
