import { Flex, Text, HStack, Button } from "@chakra-ui/react";

export function StatusBar(props: {
  words: number;
  activeHeading?: string | null;
  previewMode: boolean;
  onTogglePreview: () => void;
  zenMode?: boolean;
  onToggleZen?: () => void;
}) {
  return (
    <Flex
      h="26px"
      px={3}
      align="center"
      justify="space-between"
      borderTopWidth="1px"
      bg={{ _light: "gray.50", _dark: "gray.900" }}
      fontSize="xs"
      flexShrink={0}
    >
      <HStack gap={3}>
        <Text>
          Words: {props.words}
          {props.activeHeading ? ` · ${props.activeHeading}` : ""}
        </Text>
      </HStack>
      <HStack gap={2}>
        {props.onToggleZen && (
          <Button size="xs" variant="ghost" onClick={props.onToggleZen}>
            {props.zenMode ? "Exit Zen" : "Zen"}
          </Button>
        )}
        <Button size="xs" variant={props.previewMode ? "solid" : "ghost"} onClick={props.onTogglePreview}>
          {props.previewMode ? "Edit" : "Preview"}
        </Button>
      </HStack>
    </Flex>
  );
}
