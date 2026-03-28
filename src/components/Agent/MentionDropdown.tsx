import { Box, Text, VStack } from "@chakra-ui/react";
import type { SectionRef } from "@/types/agent";

export type MentionOption =
  | { type: "section"; section: SectionRef }
  | { type: "document" }
  | { type: "clipboard" };

export function MentionDropdown(props: {
  options: MentionOption[];
  onPick: (o: MentionOption) => void;
  onClose: () => void;
}) {
  if (props.options.length === 0) return null;
  return (
    <Box
      position="absolute"
      left={0}
      right={0}
      bottom="100%"
      mb={2}
      maxH="200px"
      overflowY="auto"
      borderWidth="1px"
      borderRadius="xl"
      borderColor={{ _light: "blackAlpha.200", _dark: "whiteAlpha.150" }}
      bg={{ _light: "white", _dark: "#2a2a2c" }}
      boxShadow={{ _light: "lg", _dark: "0 12px 40px rgba(0,0,0,0.45)" }}
      zIndex={20}
      py={1}
    >
      <VStack align="stretch" gap={0}>
        {props.options.map((o, i) => (
          <Box
            key={i}
            px={3}
            py={2}
            cursor="pointer"
            fontSize="xs"
            color="fg"
            _hover={{ bg: { _light: "gray.100", _dark: "gray.700" } }}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onPick(o);
            }}
          >
            <Text fontSize="xs">
              {o.type === "section" && `@section("${o.section.title}")`}
              {o.type === "document" && "@document"}
              {o.type === "clipboard" && "@clipboard"}
            </Text>
          </Box>
        ))}
      </VStack>
    </Box>
  );
}
