import { Dialog, Portal, Button, Text, VStack, HStack, Checkbox } from "@chakra-ui/react";
import { useEffect, useState } from "react";

export type PasteFormattingChoice = "plain" | "markdown";

type Props = {
  open: boolean;
  onChoose: (choice: PasteFormattingChoice, remember: boolean) => void;
  onCancel: () => void;
};

export function PasteFormattingDialog(props: Props) {
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (props.open) setRemember(false);
  }, [props.open]);

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(e) => {
        if (!e.open) props.onCancel();
      }}
      placement="center"
    >
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" />
        <Dialog.Positioner>
          <Dialog.Content maxW="420px" p={4}>
            <Text fontWeight="semibold" fontSize="md" mb={2}>
              Clipboard has formatting
            </Text>
            <Text fontSize="sm" color="fg.muted" mb={4}>
              Keep structure (headings, lists, tables) as markdown, or paste plain text only.
            </Text>
            <VStack align="stretch" gap={3}>
              <Checkbox.Root
                checked={remember}
                onCheckedChange={(d) => setRemember(Boolean(d.checked))}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Label>Always use this choice (saved in Settings)</Checkbox.Label>
              </Checkbox.Root>
              <HStack gap={2} justify="flex-end" flexWrap="wrap" pt={2}>
                <Button variant="ghost" onClick={props.onCancel}>
                  Cancel
                </Button>
                <Button variant="outline" onClick={() => props.onChoose("plain", remember)}>
                  Plain text
                </Button>
                <Button colorPalette="blue" onClick={() => props.onChoose("markdown", remember)}>
                  Keep formatting
                </Button>
              </HStack>
            </VStack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
