import { useEffect, useState } from "react";
import {
  Dialog,
  Portal,
  Button,
  Input,
  Field,
  Text,
  VStack,
  NativeSelect,
} from "@chakra-ui/react";

const MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
];

export function SettingsDialog(props: { open: boolean; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(MODELS[0].value);
  const [autoSaveMs, setAutoSaveMs] = useState(30000);
  const [templateFolder, setTemplateFolder] = useState("");

  useEffect(() => {
    if (!props.open) return;
    const api = window.markAPI;
    if (!api) return;
    void (async () => {
      const k = (await api.getStore("anthropicApiKey")) as string | undefined;
      setKey(k ?? "");
      const m = (await api.getStore("claudeModel")) as string | undefined;
      if (m) setModel(m);
      const a = (await api.getStore("autoSaveMs")) as number | undefined;
      if (a != null) setAutoSaveMs(a);
      const t = (await api.getStore("templateFolderPath")) as string | undefined;
      setTemplateFolder(t ?? "");
    })();
  }, [props.open]);

  const save = async () => {
    const api = window.markAPI;
    if (!api) return;
    await api.setStore("anthropicApiKey", key.trim());
    await api.setStore("claudeModel", model);
    await api.setStore("autoSaveMs", autoSaveMs);
    await api.setStore("templateFolderPath", templateFolder.trim() || undefined);
    props.onClose();
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={(e) => !e.open && props.onClose()} placement="center">
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" />
        <Dialog.Positioner>
          <Dialog.Content maxW="480px" p={4}>
            <Text fontWeight="bold" mb={3}>
              Settings
            </Text>
            <VStack gap={3} align="stretch">
              <Field.Root>
                <Field.Label>Anthropic API key</Field.Label>
                <Input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="sk-ant-…"
                  autoComplete="off"
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Model</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field value={model} onChange={(e) => setModel(e.target.value)}>
                    {MODELS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root>
                <Field.Label>Auto-save (ms)</Field.Label>
                <Input
                  type="number"
                  value={String(autoSaveMs)}
                  onChange={(e) => setAutoSaveMs(Number(e.target.value) || 0)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Extra template folder (optional)</Field.Label>
                <Input
                  value={templateFolder}
                  onChange={(e) => setTemplateFolder(e.target.value)}
                  placeholder="C:\\Templates"
                />
              </Field.Root>
              <Button colorPalette="blue" onClick={() => void save()}>
                Save
              </Button>
            </VStack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
