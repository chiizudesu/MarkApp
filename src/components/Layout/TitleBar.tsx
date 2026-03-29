import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Box, Flex, Text, IconButton, HStack, Menu, Tooltip } from "@chakra-ui/react";
import { useColorMode } from "@/components/ui/color-mode";
import { modShortcut } from "@/utils/platform";
import {
  FilePlus,
  FolderOpen,
  Save,
  MoreHorizontal,
  LayoutTemplate,
  SaveAll,
  Settings,
  Sun,
  Moon,
} from "lucide-react";

const dragStyle: CSSProperties = { WebkitAppRegion: "drag" };
const noDragStyle: CSSProperties = { WebkitAppRegion: "no-drag" };

/** Diagonals read heavier than horizontal 1px lines; sub-1 stroke helps match minimize/maximize weight. */
function CaptionCloseGlyph() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        d="M2.5 2.5 L7.5 7.5 M7.5 2.5 L2.5 7.5"
        stroke="currentColor"
        strokeWidth={0.5}
        strokeLinecap="butt"
      />
    </svg>
  );
}

function WindowControls(props: { maximized: boolean }) {
  const api = window.markAPI;
  if (!api) return null;

  const ctrl = {
    h: "32px",
    minW: "46px",
    w: "46px",
    borderRadius: 0,
    p: 0,
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    flexShrink: 0,
    color: "fg.muted",
    style: noDragStyle,
    transition: "background 0.12s ease, color 0.12s ease",
    cursor: "default" as const,
    _focus: { boxShadow: "none", bg: "transparent" },
  };

  const maximizeGlyph = props.maximized ? (
    <Box position="relative" w="10px" h="10px" flexShrink={0} aria-hidden>
      <Box
        position="absolute"
        top="0px"
        right="0px"
        w="7px"
        h="7px"
        border="1px solid"
        borderColor="currentColor"
        bg="transparent"
      />
      <Box
        position="absolute"
        bottom="0px"
        left="0px"
        w="7px"
        h="7px"
        border="1px solid"
        borderColor="currentColor"
        bg="transparent"
      />
    </Box>
  ) : (
    <Box w="10px" h="10px" border="1px solid" borderColor="currentColor" bg="transparent" flexShrink={0} aria-hidden />
  );

  return (
    <HStack gap={0} h="32px" align="stretch" flexShrink={0} style={noDragStyle} ml={1}>
      <IconButton
        variant="ghost"
        {...ctrl}
        aria-label="Minimize"
        onClick={() => api.windowMinimize()}
        _hover={{ bg: "bg.emphasized" }}
      >
        <Box w="10px" h="1px" bg="currentColor" borderRadius="1px" flexShrink={0} aria-hidden />
      </IconButton>

      <Box
        {...ctrl}
        bg="transparent"
        border="none"
        outline="none"
        _hover={{ bg: "bg.emphasized" }}
        _active={{ bg: "bg.emphasized" }}
        asChild
      >
        <button
          type="button"
          aria-label={props.maximized ? "Restore" : "Maximize"}
          onClick={() => api.windowToggleMaximize()}
        >
          {maximizeGlyph}
        </button>
      </Box>

      <IconButton
        variant="ghost"
        {...ctrl}
        aria-label="Close"
        onClick={() => api.windowClose()}
        _hover={{ bg: "red.600", color: "white" }}
      >
        <CaptionCloseGlyph />
      </IconButton>
    </HStack>
  );
}

function TTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content px={2} py={1} fontSize="xs" maxW="280px">
          {label}
        </Tooltip.Content>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

export function TitleBar(props: {
  title: string;
  dirty: boolean;
  recentFiles: string[];
  onRefreshRecents: () => void;
  onNewBlank: () => void;
  onTemplateNew: () => void;
  onOpenBrowse: () => void;
  onOpenRecent: (path: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onTemplateManager: () => void;
  onSettings: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const { colorMode, setColorMode } = useColorMode();

  useEffect(() => {
    const api = window.markAPI;
    if (!api) return;
    void api.windowIsMaximized().then(setMaximized);
    return api.subscribeWindowMaximized(setMaximized);
  }, []);

  const onTitleBarDoubleClick = () => {
    window.markAPI?.windowToggleMaximize();
  };

  const recent = props.recentFiles.filter(Boolean).slice(0, 12);
  const saveLabel = `Save (${modShortcut("S")})`;

  return (
    <Flex
      h="32px"
      align="stretch"
      borderBottomWidth="1px"
      borderColor="border.muted"
      bg="bg.muted"
      flexShrink={0}
      overflow="hidden"
    >
      <Flex
        w="36px"
        flexShrink={0}
        align="center"
        justify="center"
        borderRightWidth="1px"
        borderColor="border.muted"
        style={dragStyle}
        userSelect="none"
      >
        <Text fontSize="xs" fontWeight="bold" color="fg.muted">
          M
        </Text>
      </Flex>

      <HStack
        gap={0}
        px={1}
        flexShrink={0}
        align="center"
        borderRightWidth="1px"
        borderColor="border.muted"
        style={noDragStyle}
      >
        <Menu.Root
          onOpenChange={(d) => {
            if (d.open) props.onRefreshRecents();
          }}
        >
          <TTip label={`New document (${modShortcut("N")})`}>
            <Menu.Trigger asChild>
              <IconButton aria-label="New document" size="sm" variant="ghost" css={{ _icon: { boxSize: "4" } }}>
                <FilePlus size={16} />
              </IconButton>
            </Menu.Trigger>
          </TTip>
          <Menu.Positioner>
            <Menu.Content minW="200px">
              <Menu.Item value="blank" onSelect={() => props.onNewBlank()}>
                New blank document
              </Menu.Item>
              <Menu.Item value="tpl" onSelect={() => props.onTemplateNew()}>
                New from template…
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>

        <Menu.Root
          onOpenChange={(d) => {
            if (d.open) props.onRefreshRecents();
          }}
        >
          <TTip label={`Open file (${modShortcut("O")}) — Browse or recent`}>
            <Menu.Trigger asChild>
              <IconButton aria-label="Open" size="sm" variant="ghost" css={{ _icon: { boxSize: "4" } }}>
                <FolderOpen size={16} />
              </IconButton>
            </Menu.Trigger>
          </TTip>
          <Menu.Positioner>
            <Menu.Content minW="240px">
              <Menu.Item value="browse" onSelect={() => props.onOpenBrowse()}>
                Browse…
              </Menu.Item>
              {recent.length > 0 && <Menu.Separator />}
              {recent.map((path) => (
                <Menu.Item
                  key={path}
                  value={path}
                  title={path}
                  onSelect={() => props.onOpenRecent(path)}
                >
                  <Text truncate fontSize="sm" maxW="220px">
                    {path.split(/[/\\]/).pop() ?? path}
                  </Text>
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>

        <TTip label={saveLabel}>
          <IconButton
            aria-label="Save"
            size="sm"
            variant="ghost"
            onClick={() => props.onSave()}
            css={{ _icon: { boxSize: "4" } }}
          >
            <Save size={16} />
          </IconButton>
        </TTip>

        <Menu.Root>
          <TTip label="More — Save as, templates, settings, theme">
            <Menu.Trigger asChild>
              <IconButton aria-label="More options" size="sm" variant="ghost" css={{ _icon: { boxSize: "4" } }}>
                <MoreHorizontal size={16} />
              </IconButton>
            </Menu.Trigger>
          </TTip>
          <Menu.Positioner>
            <Menu.Content minW="220px">
              <Menu.Item value="saveas" onSelect={() => props.onSaveAs()}>
                <HStack justify="space-between" w="full">
                  <HStack gap={2}>
                    <SaveAll size={14} />
                    <Text>Save as…</Text>
                  </HStack>
                  <Text fontSize="xs" color="fg.muted">
                    {modShortcut("Shift+S")}
                  </Text>
                </HStack>
              </Menu.Item>
              <Menu.Item value="tmpl" onSelect={() => props.onTemplateManager()}>
                <HStack gap={2}>
                  <LayoutTemplate size={14} />
                  <Text>Template manager</Text>
                </HStack>
              </Menu.Item>
              <Menu.Item value="settings" onSelect={() => props.onSettings()}>
                <HStack gap={2}>
                  <Settings size={14} />
                  <Text>Settings</Text>
                </HStack>
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item value="light" onSelect={() => setColorMode("light")}>
                <HStack gap={2}>
                  <Sun size={14} />
                  <Text>Use light theme</Text>
                  {colorMode === "light" ? <Text fontSize="xs">✓</Text> : null}
                </HStack>
              </Menu.Item>
              <Menu.Item value="dark" onSelect={() => setColorMode("dark")}>
                <HStack gap={2}>
                  <Moon size={14} />
                  <Text>Use dark theme</Text>
                  {colorMode === "dark" ? <Text fontSize="xs">✓</Text> : null}
                </HStack>
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>
      </HStack>

      <Flex flex="1" minW={0} align="center" justify="center" px={4} style={dragStyle} onDoubleClick={onTitleBarDoubleClick}>
        <Text
          fontSize="xs"
          fontWeight="medium"
          color="fg.muted"
          truncate
          textAlign="center"
          maxW="min(560px, 46vw)"
          letterSpacing="tight"
          userSelect="none"
        >
          {props.title}
          {props.dirty ? " ·" : ""}
        </Text>
      </Flex>

      <HStack gap={0} pr={0} flexShrink={0} align="center" style={noDragStyle}>
        <WindowControls maximized={maximized} />
      </HStack>
    </Flex>
  );
}
