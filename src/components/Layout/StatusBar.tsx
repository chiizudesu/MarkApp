import { Flex, Text, HStack } from "@chakra-ui/react";

export function StatusBar(props: {
  sectionCount: number;
  words: number;
  activeHeading?: string | null;
  agentStatus?: string | null;
}) {
  return (
    <Flex
      h="26px"
      px={3}
      align="center"
      borderTopWidth="1px"
      bg={{ _light: "gray.50", _dark: "gray.900" }}
      fontSize="xs"
      flexShrink={0}
    >
      <HStack gap={3} minW={0} flex="1">
        <Text truncate>
          Sections: {props.sectionCount} · Words: {props.words}
          {props.activeHeading ? ` · ${props.activeHeading}` : ""}
          {props.agentStatus ? ` · ${props.agentStatus}` : ""}
        </Text>
      </HStack>
    </Flex>
  );
}
