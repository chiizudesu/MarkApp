import { useState } from "react";
import { Dialog, Portal, Button, Input, Field, Text, VStack } from "@chakra-ui/react";

export function QuickAIDialog(props: {
  open: boolean;
  onClose: () => void;
  sectionTitle: string;
  onRun: (instruction: string) => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    try {
      await props.onRun(instruction.trim());
      setInstruction("");
      props.onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(e) => {
        if (!e.open) props.onClose();
      }}
      placement="center"
    >
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" />
        <Dialog.Positioner>
          <Dialog.Content maxW="440px" p={4}>
            <Text fontWeight="bold" mb={1}>
              AI edit section
            </Text>
            <Text fontSize="sm" color="gray.600" mb={3}>
              {props.sectionTitle}
            </Text>
            <VStack gap={3} align="stretch">
              <Field.Root>
                <Field.Label>Instruction</Field.Label>
                <Input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. Make this more concise"
                  onKeyDown={(e) => e.key === "Enter" && void run()}
                />
              </Field.Root>
              <Button colorPalette="blue" loading={busy} onClick={() => void run()}>
                Run
              </Button>
            </VStack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
