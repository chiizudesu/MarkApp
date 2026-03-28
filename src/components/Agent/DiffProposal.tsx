import { Box, Button, HStack, Text } from "@chakra-ui/react";

export function DiffProposal(props: {
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  return (
    <Box
      borderWidth="1px"
      borderRadius="xl"
      px={3}
      py={2.5}
      bg={{ _light: "orange.50", _dark: "#2a2620" }}
      borderColor={{ _light: "orange.200", _dark: "whiteAlpha.100" }}
      fontSize="xs"
    >
      <Text fontWeight="semibold" mb={2} color="fg">
        Proposed edit
      </Text>
      <Text color="fg.muted" mb={3} lineHeight="short">
        Review highlighted changes in the message above, then accept or reject to update the document.
      </Text>
      <HStack gap={2} flexWrap="wrap">
        <Button size="sm" colorPalette="green" borderRadius="lg" onClick={props.onAcceptAll}>
          Accept all
        </Button>
        <Button size="sm" variant="outline" borderRadius="lg" onClick={props.onRejectAll}>
          Reject all
        </Button>
      </HStack>
    </Box>
  );
}
