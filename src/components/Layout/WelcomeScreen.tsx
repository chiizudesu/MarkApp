import { Box, Button, Flex, Heading, Text, VStack, HStack } from "@chakra-ui/react";
import { FilePlus, FolderOpen, Sparkles, Keyboard } from "lucide-react";
import { modShortcut, modShiftShortcut } from "@/utils/platform";

function Tip(props: { children: React.ReactNode }) {
  return (
    <HStack align="flex-start" gap={2} py={1}>
      <Box mt={0.5} color="fg.muted">
        <Keyboard size={14} />
      </Box>
      <Text fontSize="sm" color="fg.muted">
        {props.children}
      </Text>
    </HStack>
  );
}

export function WelcomeScreen(props: {
  recentFiles: string[];
  onStartWriting: () => void;
  onOpen: () => void;
  onNewFromTemplate: () => void;
  onOpenRecent: (path: string) => void;
}) {
  const recent = props.recentFiles.filter(Boolean).slice(0, 8);

  return (
    <Flex flex="1" align="center" justify="center" minH={0} p={6} bg={{ _light: "gray.50", _dark: "gray.950" }}>
      <Box
        maxW="480px"
        w="full"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="xl"
        p={8}
        bg="bg"
        boxShadow="sm"
      >
        <VStack align="stretch" gap={6}>
          <VStack align="flex-start" gap={1}>
            <Heading size="md" fontWeight="semibold">
              Welcome to MarkApp
            </Heading>
            <Text fontSize="sm" color="fg.muted" lineHeight="tall">
              A markdown editor with Claude in the sidebar. Open a file or start a new document.
            </Text>
          </VStack>

          <VStack align="stretch" gap={2}>
            <Button size="sm" colorPalette="blue" onClick={props.onStartWriting} justifyContent="flex-start" gap={2}>
              <FilePlus size={16} />
              Start writing
            </Button>
            <Button size="sm" variant="outline" onClick={() => props.onOpen()} justifyContent="flex-start" gap={2}>
              <FolderOpen size={16} />
              Open file…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={props.onNewFromTemplate}
              justifyContent="flex-start"
              gap={2}
            >
              <Sparkles size={16} />
              New from template…
            </Button>
          </VStack>

          {recent.length > 0 && (
            <VStack align="stretch" gap={2}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted" letterSpacing="tight">
                Recent files
              </Text>
              <VStack align="stretch" gap={0}>
                {recent.map((path) => (
                  <Button
                    key={path}
                    size="xs"
                    variant="ghost"
                    justifyContent="flex-start"
                    fontWeight="normal"
                    h="auto"
                    py={1.5}
                    title={path}
                    onClick={() => props.onOpenRecent(path)}
                  >
                    <Text truncate fontSize="sm" w="full" textAlign="left">
                      {path.split(/[/\\]/).pop() ?? path}
                    </Text>
                  </Button>
                ))}
              </VStack>
            </VStack>
          )}

          <Box borderTopWidth="1px" borderColor="border.muted" pt={4}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={2} letterSpacing="tight">
              Shortcuts
            </Text>
            <VStack align="stretch" gap={0}>
              <Tip>Agent panel — {modShortcut("L")}</Tip>
              <Tip>Command palette — {modShiftShortcut("P")}</Tip>
              <Tip>
                Quick AI — {modShortcut("K")}
              </Tip>
              <Tip>
                Save — {modShortcut("S")}
              </Tip>
            </VStack>
          </Box>
        </VStack>
      </Box>
    </Flex>
  );
}
