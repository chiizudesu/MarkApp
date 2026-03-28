import { useEffect, useState } from "react";
import { Dialog, Portal, Button, Text, VStack, Box } from "@chakra-ui/react";
import { PlaceholderForm } from "./PlaceholderForm";

type Item = { path: string; name: string; source: string };

export function TemplatePicker(props: {
  open: boolean;
  onClose: () => void;
  onCreateFromMarkdown: (md: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [pick, setPick] = useState<Item | null>(null);
  const [body, setBody] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) {
      setPick(null);
      setBody(null);
      return;
    }
    const api = window.markAPI;
    if (api) void api.listTemplates().then(setItems);
  }, [props.open]);

  const choose = async (it: Item) => {
    const api = window.markAPI;
    if (!api) return;
    const r = await api.readFile(it.path);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    setPick(it);
    setBody(r.content);
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={(e) => !e.open && props.onClose()} size="xl">
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" />
        <Dialog.Positioner>
          <Dialog.Content maxW="640px" maxH="90vh" overflow="hidden" display="flex" flexDirection="column">
            <Box p={4} borderBottomWidth="1px">
              <Text fontWeight="bold">New from template</Text>
            </Box>
            {!body ? (
              <VStack align="stretch" p={4} overflowY="auto" flex="1" gap={1}>
                {items.length === 0 && <Text fontSize="sm">No templates found.</Text>}
                {items.map((it) => (
                  <Button key={it.path} variant="outline" size="sm" justifyContent="flex-start" onClick={() => void choose(it)}>
                    {it.name} <Text as="span" ml={2} fontSize="xs" color="gray.500">({it.source})</Text>
                  </Button>
                ))}
                <Button variant="ghost" onClick={props.onClose}>
                  Cancel
                </Button>
              </VStack>
            ) : (
              <Box overflowY="auto" flex="1">
                <Text fontSize="sm" px={4} pt={2}>
                  {pick?.name}
                </Text>
                <PlaceholderForm
                  templateBody={body}
                  onApply={(md) => {
                    props.onCreateFromMarkdown(md);
                    props.onClose();
                  }}
                  onCancel={() => {
                    setPick(null);
                    setBody(null);
                  }}
                />
              </Box>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
