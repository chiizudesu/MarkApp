import { useRef, useState, useMemo } from "react";
import { Box, Textarea, HStack, Wrap, WrapItem, Text, IconButton } from "@chakra-ui/react";
import { ChevronRight, Image as ImageIcon, Mic, Send } from "lucide-react";
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
  onSend: (text: string) => void;
  onAddSectionFromMention: (section: SectionRef) => void;
}) {
  const [text, setText] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
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
      props.contextSections.length + (props.mentionDocument ? 1 : 0) + (props.mentionClipboard ? 1 : 0),
    [props.contextSections, props.mentionDocument, props.mentionClipboard],
  );

  const hasContextPills =
    props.contextSections.length > 0 || props.mentionDocument || props.mentionClipboard;

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
        <MentionDropdown options={mentionOptions} onPick={pickMention} onClose={() => setMentionOpen(false)} />
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
        {contextCount > 0 && (
          <HStack gap={1} mb={1} color="fg.muted">
            <ChevronRight size={12} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.85 }} />
            <Text fontSize="xs" fontWeight="medium">
              {contextCount} context {contextCount === 1 ? "item" : "items"}
            </Text>
          </HStack>
        )}
        {hasContextPills && (
          <Wrap gap={1} mb={1}>
            {props.contextSections.map((s) => (
              <WrapItem key={s.id}>
                <SectionPill section={s} onRemove={() => props.onRemoveContext(s.id)} />
              </WrapItem>
            ))}
            {props.mentionDocument && (
              <WrapItem>
                <SectionPill
                  section={{ id: "__doc__", title: "Full document", content: "", from: 0, to: 0 }}
                  onRemove={() => props.onToggleDocument(false)}
                />
              </WrapItem>
            )}
            {props.mentionClipboard && (
              <WrapItem>
                <SectionPill
                  section={{ id: "__clip__", title: "Clipboard", content: "", from: 0, to: 0 }}
                  onRemove={() => props.onToggleClipboard(false)}
                />
              </WrapItem>
            )}
          </Wrap>
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
        <HStack justify="flex-end" align="center" gap={0} mt={1} pt={1} borderTopWidth="1px" borderColor="border.muted">
          <IconButton aria-label="Attach image (coming soon)" size="xs" variant="ghost" disabled opacity={0.4}>
            <ImageIcon size={16} strokeWidth={1.75} />
          </IconButton>
          <IconButton aria-label="Voice input (coming soon)" size="xs" variant="ghost" disabled opacity={0.4}>
            <Mic size={16} strokeWidth={1.75} />
          </IconButton>
          <IconButton
            aria-label="Send"
            size="xs"
            variant="solid"
            colorPalette="blue"
            borderRadius="full"
            disabled={props.disabled || !text.trim()}
            onClick={send}
            ml={0.5}
          >
            <Send size={14} strokeWidth={2} />
          </IconButton>
        </HStack>
      </Box>
    </Box>
  );
}
