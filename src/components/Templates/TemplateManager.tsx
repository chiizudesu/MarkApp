import { useEffect, useState } from "react";
import {
  Dialog,
  Portal,
  Button,
  Text,
  VStack,
  HStack,
  Textarea,
  Field,
  Input,
  Box,
  IconButton,
} from "@chakra-ui/react";
import { Trash2 } from "lucide-react";

type Item = { path: string; name: string; source: string };

export function TemplateManager(props: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState("# New template\n\nHello {{name}}\n");

  const reload = () => {
    const api = window.markAPI;
    if (!api) return;
    void api.listTemplates().then(setItems);
  };

  useEffect(() => {
    if (props.open) reload();
  }, [props.open]);

  const saveNew = async () => {
    const api = window.markAPI;
    if (!api) return;
    const dir = await api.userTemplatesDir();
    const base = name.trim().replace(/\.md$/i, "") || "template";
    const safe = base.replace(/[^a-zA-Z0-9-_]+/g, "_");
    const path = `${dir}\\${safe}.md`;
    const r = await api.saveTemplateFile(path, content);
    if (!r.ok) {
      alert(r.error);
      return;
    }
    setName("");
    reload();
  };

  const del = async (it: Item) => {
    if (it.source === "bundled") {
      alert("Cannot delete bundled templates.");
      return;
    }
    if (!confirm(`Delete ${it.name}?`)) return;
    const api = window.markAPI;
    if (!api) return;
    const r = await api.deleteTemplateFile(it.path);
    if (!r.ok) alert(r.error);
    reload();
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={(e) => !e.open && props.onClose()} size="xl">
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" />
        <Dialog.Positioner>
          <Dialog.Content maxW="720px" maxH="90vh">
            <Box p={4} borderBottomWidth="1px">
              <Text fontWeight="bold">Template manager</Text>
              <Text fontSize="xs" color="gray.600" mt={1}>
                User templates save under your app data folder. Bundled templates are read-only.
              </Text>
            </Box>
            <VStack align="stretch" p={4} gap={3} overflowY="auto" maxH="65vh">
              {items.map((it) => (
                <HStack key={it.path} justify="space-between" p={2} borderWidth="1px" borderRadius="md">
                  <Text fontSize="sm" truncate flex="1">
                    {it.name}{" "}
                    <Text as="span" fontSize="xs" color="gray.500">
                      ({it.source})
                    </Text>
                  </Text>
                  {it.source !== "bundled" && (
                    <IconButton aria-label="Delete" size="sm" variant="ghost" colorPalette="red" onClick={() => void del(it)}>
                      <Trash2 size={14} />
                    </IconButton>
                  )}
                </HStack>
              ))}
              <Text fontWeight="semibold" fontSize="sm">
                New user template
              </Text>
              <Field.Root>
                <Field.Label>File name (without .md)</Field.Label>
                <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="my_template" />
              </Field.Root>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                fontFamily="mono"
                fontSize="sm"
                rows={8}
              />
              <Button colorPalette="blue" onClick={() => void saveNew()}>
                Save template
              </Button>
              <Button variant="ghost" onClick={props.onClose}>
                Close
              </Button>
            </VStack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
