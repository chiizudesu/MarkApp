import { Dialog, Portal, Button, Text, VStack, Box, HStack, Spinner } from "@chakra-ui/react";

export function AiPdfExportDialog(props: {
  open: boolean;
  /** While true, backdrop / dismiss is ignored so the export cannot be interrupted. */
  busy: boolean;
  /** 0–100 */
  progress: number;
  /** Current step description. */
  status: string;
  error: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const pct = Math.max(0, Math.min(100, props.progress));

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(e) => {
        if (!e.open && props.busy) return;
        props.onOpenChange(e.open);
      }}
      placement="center"
    >
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" />
        <Dialog.Positioner>
          <Dialog.Content maxW="460px" p={5}>
            <Text fontWeight="semibold" fontSize="md" mb={1}>
              Export AI-enhanced PDF
            </Text>
            <Text fontSize="sm" color="fg.muted" mb={4}>
              The AI only maps your markdown into print structure and picks an accent color — it should keep
              your wording verbatim (pipe tables may be split into rows/columns for the PDF). MarkApp draws
              the file with pdf-lib. Uses the same Anthropic API key and model as Settings.
            </Text>

            <VStack align="stretch" gap={3} mb={4}>
              <Text fontSize="xs" color="fg.muted" fontWeight="medium">
                What happens
              </Text>
              <VStack align="stretch" gap={1} pl={1}>
                <Text fontSize="sm" color="fg.muted">
                  • AI returns a layout JSON (titles, headings, paragraphs, lists, tables) without rewriting
                  your prose.
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  • The app draws A4 pages: accent title band, pill or bar headings, card-style lists (or pill rows
                  for “Label – detail” items), tables, dividers.
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  • You choose where to save the .pdf file (large documents may use an excerpt for the AI step).
                </Text>
              </VStack>
            </VStack>

            <Box mb={3}>
              <Box
                h="8px"
                borderRadius="full"
                bg="bg.emphasized"
                overflow="hidden"
                borderWidth="1px"
                borderColor="border.muted"
              >
                <Box
                  h="full"
                  borderRadius="full"
                  bg="blue.500"
                  w={`${pct}%`}
                  transition="width 0.25s ease"
                />
              </Box>
              <HStack mt={2} gap={2} align="center">
                {props.busy ? <Spinner size="sm" /> : null}
                <Text fontSize="sm" color="fg.muted" flex={1}>
                  {props.status || (props.busy ? "Working…" : "")}
                </Text>
              </HStack>
            </Box>

            {props.error ? (
              <Box
                mb={4}
                p={3}
                borderRadius="md"
                bg="red.subtle"
                borderWidth="1px"
                borderColor="red.muted"
              >
                <Text fontSize="sm" color="red.fg">
                  {props.error}
                </Text>
              </Box>
            ) : null}

            {!props.busy ? (
              <HStack justify="flex-end" pt={1}>
                <Button variant="solid" colorPalette="blue" onClick={() => props.onOpenChange(false)}>
                  Close
                </Button>
              </HStack>
            ) : null}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
