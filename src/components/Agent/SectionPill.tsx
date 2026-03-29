import { HStack, Text, IconButton } from "@chakra-ui/react";
import { X } from "lucide-react";
import type { SectionRef } from "@/types/agent";

export function SectionPill(props: { section: SectionRef; onRemove: () => void }) {
  return (
    <HStack
      display="inline-flex"
      alignItems="center"
      gap={0.5}
      px={2}
      py={0.5}
      h="24px"
      borderRadius="full"
      borderWidth="1px"
      borderColor={{ _light: "blackAlpha.200", _dark: "whiteAlpha.150" }}
      bg={{ _light: "white", _dark: "gray.800" }}
      fontSize="xs"
      color="fg"
      maxW="200px"
    >
      <Text as="span" truncate flex="1" title={props.section.title}>
        {props.section.title}
      </Text>
      <IconButton
        aria-label="Remove section"
        size="xs"
        variant="ghost"
        minW="22px"
        h="22px"
        color="fg.muted"
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
      >
        <X size={12} strokeWidth={2} />
      </IconButton>
    </HStack>
  );
}
