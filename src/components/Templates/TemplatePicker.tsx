import { useEffect, useState } from "react";
import { Dialog, Portal, Button, Text, VStack, Box, Flex, HStack } from "@chakra-ui/react";

type Item = { path: string; name: string; source: string };

export function TemplatePicker(props: {
  open: boolean;
  onClose: () => void;
  onCreateFromMarkdown: (md: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    if (!props.open) return;
    const api = window.markAPI;
    if (api) void api.listTemplates().then(setItems);
  }, [props.open]);

  const openTemplate = async (it: Item) => {
    const api = window.markAPI;
    if (!api) return;
    const r = await api.readFile(it.path);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    props.onCreateFromMarkdown(r.content);
    props.onClose();
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={(e) => !e.open && props.onClose()} placement="center">
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.700" />
        <Dialog.Positioner>
          <Dialog.Content
            maxW="min(90vw, 640px)"
            w="full"
            p={0}
            overflow="hidden"
            display="flex"
            flexDirection="column"
            maxH="85vh"
            bg="bg"
            borderWidth="1px"
            borderColor="border"
            shadow="lg"
          >
            <Box
              px={6}
              pt={5}
              pb={4}
              borderBottomWidth="1px"
              borderColor="border.muted"
              bg="bg.subtle"
              flexShrink={0}
            >
              <Text fontWeight="semibold" fontSize="xl" color="fg" letterSpacing="tight">
                Templates
              </Text>
              <Text fontSize="sm" color="fg.muted" mt={1} lineHeight="short">
                Your saved templates and markdown files in the extra template folder (Settings → Files). Select one to
                open as a new document.
              </Text>
            </Box>

            <Flex direction="column" flex="1" minH={0} overflow="hidden">
              <Box flex="1" minH={0} overflowY="auto" px={6} py={5}>
                <VStack align="stretch" gap={2}>
                  {items.length === 0 && (
                    <Text fontSize="sm" color="fg.muted">
                      No templates found. Save templates in Template manager or set an extra template folder under
                      Settings → Files.
                    </Text>
                  )}
                  {items.map((it) => (
                    <Button
                      key={it.path}
                      variant="outline"
                      size="sm"
                      justifyContent="flex-start"
                      onClick={() => void openTemplate(it)}
                      borderColor="border"
                      bg="bg"
                      _hover={{ bg: "bg.muted" }}
                    >
                      <Text as="span" truncate flex="1" textAlign="left">
                        {it.name}
                      </Text>
                      <Text as="span" ml={2} fontSize="xs" color="fg.muted" flexShrink={0}>
                        ({it.source})
                      </Text>
                    </Button>
                  ))}
                </VStack>
              </Box>
              <HStack
                gap={2}
                justify="flex-end"
                px={6}
                py={4}
                borderTopWidth="1px"
                borderColor="border.muted"
                bg="bg.subtle"
                flexShrink={0}
              >
                <Button variant="ghost" onClick={props.onClose}>
                  Close
                </Button>
              </HStack>
            </Flex>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
