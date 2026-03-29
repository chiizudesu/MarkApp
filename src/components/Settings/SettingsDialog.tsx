import { useEffect, useState } from "react";
import {
  Dialog,
  Portal,
  Button,
  Input,
  Field,
  Text,
  VStack,
  HStack,
  NativeSelect,
  Separator,
} from "@chakra-ui/react";
import { openDirectoryDialog } from "@/services/documentService";
import { testAnthropicConnection } from "@/services/claude";

const MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
];

const AUTO_SAVE_OPTIONS = [
  { ms: 0, label: "Off" },
  { ms: 10_000, label: "Every 10 seconds" },
  { ms: 30_000, label: "Every 30 seconds" },
  { ms: 60_000, label: "Every minute" },
  { ms: 300_000, label: "Every 5 minutes" },
] as const;

export function SettingsDialog(props: { open: boolean; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(MODELS[0].value);
  const [autoSaveMs, setAutoSaveMs] = useState(30_000);
  const [templateFolder, setTemplateFolder] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const api = window.markAPI;
    if (!api) return;
    setTestMsg(null);
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

  const browseFolder = async () => {
    const p = await openDirectoryDialog();
    if (p) setTemplateFolder(p);
  };

  const testConnection = async () => {
    setTestMsg(null);
    setTesting(true);
    try {
      await testAnthropicConnection(key, model);
      setTestMsg("Connection OK");
    } catch (e) {
      setTestMsg((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={(e) => !e.open && props.onClose()} placement="center">
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" />
        <Dialog.Positioner>
          <Dialog.Content maxW="500px" p={4}>
            <Text fontWeight="bold" fontSize="lg" mb={1}>
              Settings
            </Text>
            <Text fontSize="sm" color="fg.muted" mb={4}>
              AI, editor behavior, and template paths.
            </Text>

            <VStack gap={4} align="stretch">
              <VStack align="stretch" gap={2}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted" letterSpacing="wider">
                  AI
                </Text>
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
                <HStack>
                  <Button size="sm" variant="outline" loading={testing} onClick={() => void testConnection()}>
                    Test connection
                  </Button>
                  {testMsg ? (
                    <Text fontSize="xs" color={testMsg === "Connection OK" ? "green.500" : "red.500"}>
                      {testMsg}
                    </Text>
                  ) : null}
                </HStack>
              </VStack>

              <Separator />

              <VStack align="stretch" gap={2}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.muted" letterSpacing="wider">
                  Files
                </Text>
                <Field.Root>
                  <Field.Label>Auto-save</Field.Label>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={String(autoSaveMs)}
                      onChange={(e) => setAutoSaveMs(Number(e.target.value))}
                    >
                      {AUTO_SAVE_OPTIONS.map((o) => (
                        <option key={o.ms} value={o.ms}>
                          {o.label}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Extra template folder (optional)</Field.Label>
                  <HStack gap={2}>
                    <Input
                      flex="1"
                      value={templateFolder}
                      onChange={(e) => setTemplateFolder(e.target.value)}
                      placeholder="C:\\Templates"
                    />
                    <Button size="sm" variant="outline" onClick={() => void browseFolder()}>
                      Browse…
                    </Button>
                  </HStack>
                </Field.Root>
              </VStack>

              <HStack gap={2} justify="flex-end" pt={2}>
                <Button variant="ghost" onClick={props.onClose}>
                  Cancel
                </Button>
                <Button colorPalette="blue" onClick={() => void save()}>
                  Save
                </Button>
              </HStack>
            </VStack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
