import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  Portal,
  Button,
  Input,
  Field,
  Text,
  Textarea,
  VStack,
  HStack,
  NativeSelect,
  Checkbox,
  Tabs,
  Box,
  Flex,
} from "@chakra-ui/react";
import { ClipboardPaste, FolderOpen, Sparkles } from "lucide-react";
import { openDirectoryDialog } from "@/services/documentService";
import { DEFAULT_CLAUDE_MODEL, normalizeStoredClaudeModel, testAnthropicConnection } from "@/services/claude";
import {
  parsePasteDefaultRichHandling,
  type PasteDefaultRichHandling,
} from "@/services/clipboardPaste";

const MODELS = [
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
];

const AUTO_SAVE_OPTIONS = [
  { ms: 0, label: "Off" },
  { ms: 10_000, label: "Every 10 seconds" },
  { ms: 30_000, label: "Every 30 seconds" },
  { ms: 60_000, label: "Every minute" },
  { ms: 300_000, label: "Every 5 minutes" },
] as const;

const tabIconProps = { size: 18, strokeWidth: 2 } as const;

/** Fixed shell height so switching tabs does not grow/shrink the dialog. */
const SETTINGS_DIALOG_HEIGHT = "min(600px, 85vh)";

function TabLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <HStack gap={2} w="full" justify="flex-start">
      <Box as="span" color="inherit" display="flex" alignItems="center" opacity={0.92}>
        {icon}
      </Box>
      <Text as="span" fontWeight="medium">
        {label}
      </Text>
    </HStack>
  );
}

export function SettingsDialog(props: { open: boolean; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(DEFAULT_CLAUDE_MODEL);
  const [autoSaveMs, setAutoSaveMs] = useState(30_000);
  const [templateFolder, setTemplateFolder] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [behavioralMemoryEnabled, setBehavioralMemoryEnabled] = useState(false);
  const [behavioralMemory, setBehavioralMemory] = useState("");
  const [disallowAgentCodeBlocks, setDisallowAgentCodeBlocks] = useState(false);
  const [pasteRichHandling, setPasteRichHandling] = useState<PasteDefaultRichHandling>("ask");
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
      const normalized = normalizeStoredClaudeModel(m);
      setModel(normalized);
      if (normalized !== (m?.trim() ?? "")) {
        await api.setStore("claudeModel", normalized);
      }
      const a = (await api.getStore("autoSaveMs")) as number | undefined;
      if (a != null) setAutoSaveMs(a);
      const t = (await api.getStore("templateFolderPath")) as string | undefined;
      setTemplateFolder(t ?? "");
      const ci = (await api.getStore("agentCustomInstructions")) as string | undefined;
      setCustomInstructions(ci ?? "");
      const bmOn = (await api.getStore("agentBehavioralMemoryEnabled")) as boolean | undefined;
      setBehavioralMemoryEnabled(Boolean(bmOn));
      const bm = (await api.getStore("agentBehavioralMemory")) as string | undefined;
      setBehavioralMemory(bm ?? "");
      const noFences = (await api.getStore("agentDisallowCodeBlocks")) as boolean | undefined;
      setDisallowAgentCodeBlocks(Boolean(noFences));
      const paste = await api.getStore("pasteDefaultRichHandling");
      setPasteRichHandling(parsePasteDefaultRichHandling(paste));
    })();
  }, [props.open]);

  const save = async () => {
    const api = window.markAPI;
    if (!api) return;
    await api.setStore("anthropicApiKey", key.trim());
    await api.setStore("claudeModel", model);
    await api.setStore("autoSaveMs", autoSaveMs);
    await api.setStore("templateFolderPath", templateFolder.trim() || undefined);
    await api.setStore("agentCustomInstructions", customInstructions.trim() || undefined);
    await api.setStore("agentBehavioralMemoryEnabled", behavioralMemoryEnabled);
    await api.setStore("agentBehavioralMemory", behavioralMemory.trim() || undefined);
    await api.setStore("agentDisallowCodeBlocks", disallowAgentCodeBlocks);
    await api.setStore("pasteDefaultRichHandling", pasteRichHandling);
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

  const testOk = testMsg === "Connection OK";

  return (
    <Dialog.Root open={props.open} onOpenChange={(e) => !e.open && props.onClose()} placement="center">
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.700" />
        <Dialog.Positioner>
          <Dialog.Content
            maxW="min(90vw, 760px)"
            w="full"
            p={0}
            overflow="hidden"
            display="flex"
            flexDirection="column"
            h={SETTINGS_DIALOG_HEIGHT}
            minH={SETTINGS_DIALOG_HEIGHT}
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
                Settings
              </Text>
              <Text fontSize="sm" color="fg.muted" mt={1} lineHeight="short">
                AI, editor behavior, and file paths. Choose a category on the left.
              </Text>
            </Box>

            <Tabs.Root
              defaultValue="ai"
              orientation="vertical"
              variant="subtle"
              colorPalette="blue"
              size="md"
              flex="1"
              minH="0"
              display="flex"
              alignItems="stretch"
              overflow="hidden"
            >
              <Tabs.List
                w="200px"
                flexShrink={0}
                alignSelf="stretch"
                alignItems="stretch"
                py={3}
                px={2}
                gap={1}
                bg="bg.muted"
                borderEndWidth="1px"
                borderColor="border.muted"
              >
                <Tabs.Trigger value="ai" justifyContent="flex-start" rounded="md" py={2.5}>
                  <TabLabel icon={<Sparkles {...tabIconProps} />} label="AI" />
                </Tabs.Trigger>
                <Tabs.Trigger value="editor" justifyContent="flex-start" rounded="md" py={2.5}>
                  <TabLabel icon={<ClipboardPaste {...tabIconProps} />} label="Editor" />
                </Tabs.Trigger>
                <Tabs.Trigger value="files" justifyContent="flex-start" rounded="md" py={2.5}>
                  <TabLabel icon={<FolderOpen {...tabIconProps} />} label="Files" />
                </Tabs.Trigger>
              </Tabs.List>

              <Flex direction="column" flex="1" minW="0" minH="0" overflow="hidden">
                <Tabs.ContentGroup
                  flex="1"
                  minH="0"
                  minW="0"
                  display="flex"
                  flexDirection="column"
                  overflow="hidden"
                >
                  <Tabs.Content
                    value="ai"
                    flex="1"
                    minH="0"
                    minW="0"
                    overflowY="auto"
                    px={6}
                    py={5}
                  >
                    <VStack gap={5} align="stretch" pb={2}>
                      <Field.Root>
                        <Field.Label color="fg">Anthropic API key</Field.Label>
                        <Input
                          type="password"
                          value={key}
                          onChange={(e) => setKey(e.target.value)}
                          placeholder="sk-ant-…"
                          autoComplete="off"
                          bg="bg"
                          borderColor="border"
                        />
                      </Field.Root>
                      <Field.Root>
                        <Field.Label color="fg">Model</Field.Label>
                        <NativeSelect.Root>
                          <NativeSelect.Field
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            bg="bg"
                            borderColor="border"
                          >
                            {MODELS.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      </Field.Root>
                      <HStack align="flex-start" flexWrap="wrap" gap={3}>
                        <Button size="sm" variant="outline" loading={testing} onClick={() => void testConnection()}>
                          Test connection
                        </Button>
                        {testMsg ? (
                          <Text
                            fontSize="sm"
                            fontWeight="medium"
                            color={testOk ? "green.600" : "red.600"}
                            _dark={{ color: testOk ? "green.300" : "red.300" }}
                            flex="1"
                            minW="0"
                          >
                            {testMsg}
                          </Text>
                        ) : null}
                      </HStack>
                      <Field.Root>
                        <Field.Label color="fg">Custom instructions for the agent</Field.Label>
                        <Textarea
                          value={customInstructions}
                          onChange={(e) => setCustomInstructions(e.target.value)}
                          placeholder="Tone, formatting preferences, domain rules… Applied on every chat turn."
                          rows={4}
                          resize="vertical"
                          bg="bg"
                          borderColor="border"
                        />
                        <Field.HelperText color="fg.muted">
                          Appended to the agent system prompt (keep under ~2k characters for best results). When a
                          section is pinned or the document is new/empty, the model’s full reply is written into the
                          editor—avoid telling it to ask clarifying questions in those cases.
                        </Field.HelperText>
                      </Field.Root>
                      <Field.Root>
                        <Checkbox.Root
                          checked={disallowAgentCodeBlocks}
                          onCheckedChange={(d) => setDisallowAgentCodeBlocks(Boolean(d.checked))}
                        >
                          <Checkbox.HiddenInput />
                          <Checkbox.Control borderColor="border.emphasized" />
                          <Checkbox.Label color="fg" fontWeight="medium">
                            Disallow agent to use code blocks
                          </Checkbox.Label>
                        </Checkbox.Root>
                        <Field.HelperText color="fg.muted">
                          When on, the agent is told not to wrap whole replies in markdown code fences (triple
                          backticks), which is common for document edits. Small fenced snippets for real code are
                          still allowed when relevant.
                        </Field.HelperText>
                      </Field.Root>
                      <Field.Root>
                        <Checkbox.Root
                          checked={behavioralMemoryEnabled}
                          onCheckedChange={(d) => setBehavioralMemoryEnabled(Boolean(d.checked))}
                        >
                          <Checkbox.HiddenInput />
                          <Checkbox.Control borderColor="border.emphasized" />
                          <Checkbox.Label color="fg" fontWeight="medium">
                            Include behavioral memory snippet in agent context
                          </Checkbox.Label>
                        </Checkbox.Root>
                        <Textarea
                          mt={2}
                          value={behavioralMemory}
                          onChange={(e) => setBehavioralMemory(e.target.value)}
                          placeholder="Short notes the model should remember (e.g. “Prefer UK spelling”, “User writes technical specs”)."
                          rows={3}
                          resize="vertical"
                          disabled={!behavioralMemoryEnabled}
                          bg="bg"
                          borderColor="border"
                          opacity={behavioralMemoryEnabled ? 1 : 0.65}
                        />
                      </Field.Root>
                    </VStack>
                  </Tabs.Content>

                  <Tabs.Content
                    value="editor"
                    flex="1"
                    minH="0"
                    minW="0"
                    overflowY="auto"
                    px={6}
                    py={5}
                  >
                    <VStack gap={5} align="stretch" pb={2}>
                      <Field.Root>
                        <Field.Label color="fg">Paste with formatting</Field.Label>
                        <NativeSelect.Root>
                          <NativeSelect.Field
                            value={pasteRichHandling}
                            onChange={(e) =>
                              setPasteRichHandling(parsePasteDefaultRichHandling(e.target.value))
                            }
                            bg="bg"
                            borderColor="border"
                          >
                            <option value="ask">Ask when clipboard has formatting</option>
                            <option value="markdown">Always keep as markdown</option>
                            <option value="plain">Always plain text</option>
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                        <Field.HelperText color="fg.muted">
                          Tables and rich copy from Word or the web are converted to markdown before inserting.
                        </Field.HelperText>
                      </Field.Root>
                    </VStack>
                  </Tabs.Content>

                  <Tabs.Content
                    value="files"
                    flex="1"
                    minH="0"
                    minW="0"
                    overflowY="auto"
                    px={6}
                    py={5}
                  >
                    <VStack gap={5} align="stretch" pb={2}>
                      <Field.Root>
                        <Field.Label color="fg">Auto-save</Field.Label>
                        <NativeSelect.Root>
                          <NativeSelect.Field
                            value={String(autoSaveMs)}
                            onChange={(e) => setAutoSaveMs(Number(e.target.value))}
                            bg="bg"
                            borderColor="border"
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
                        <Field.Label color="fg">Extra template folder (optional)</Field.Label>
                        <HStack gap={2}>
                          <Input
                            flex="1"
                            value={templateFolder}
                            onChange={(e) => setTemplateFolder(e.target.value)}
                            placeholder="C:\\Templates"
                            bg="bg"
                            borderColor="border"
                          />
                          <Button size="sm" variant="outline" onClick={() => void browseFolder()}>
                            Browse…
                          </Button>
                        </HStack>
                      </Field.Root>
                    </VStack>
                  </Tabs.Content>
                </Tabs.ContentGroup>

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
                    Cancel
                  </Button>
                  <Button colorPalette="blue" onClick={() => void save()}>
                    Save
                  </Button>
                </HStack>
              </Flex>
            </Tabs.Root>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
