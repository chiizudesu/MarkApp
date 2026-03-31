import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Box, Flex, Text, IconButton, HStack, Menu, Tooltip } from "@chakra-ui/react";
import { useColorMode } from "@/components/ui/color-mode";
import { chromeGhostIconProps } from "@/components/ui/quietFocusRing";
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
  Minus,
  Square,
  Copy,
  X,
} from "lucide-react";

const dragStyle: CSSProperties = { WebkitAppRegion: "drag" };
const noDragStyle: CSSProperties = { WebkitAppRegion: "no-drag" };

/** Same as EditorToolbar font dropdowns — keeps menu layering/anchor behavior consistent. */
const menuContentStyle = {
  borderRadius: "lg",
  boxShadow: "lg",
  py: 1,
  minW: "0",
} as const;

/** Match toolbar: menus open below trigger, trailing edge aligned (LTR). */
const titleBarMenuPositioning = { placement: "bottom-end" as const };

/** Lucide at fixed size so caption glyphs stay visible on high-DPI Windows (thin 1px/CSS lines were effectively missing). */
const captionIconSize = 11;
const captionIconStroke = 1.5;

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
    <Copy size={captionIconSize} strokeWidth={captionIconStroke} aria-hidden />
  ) : (
    <Square size={captionIconSize} strokeWidth={captionIconStroke} aria-hidden />
  );

  return (
    <HStack gap={0} h="32px" align="stretch" flexShrink={0} style={noDragStyle} ml={1}>
      <IconButton
        variant="ghost"
        {...ctrl}
        {...chromeGhostIconProps}
        aria-label="Minimize"
        onClick={() => api.windowMinimize()}
      >
        <Minus size={captionIconSize} strokeWidth={captionIconStroke} aria-hidden />
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
        {...chromeGhostIconProps}
        aria-label="Close"
        onClick={() => api.windowClose()}
        _hover={{ bg: "red.600", color: "white" }}
      >
        <X size={captionIconSize} strokeWidth={captionIconStroke} aria-hidden />
      </IconButton>
    </HStack>
  );
}

function TTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root openDelay={600}>
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
    <Box
      flexShrink={0}
      bg="bg.muted"
      borderBottomWidth="1px"
      borderColor="border.muted"
    >
      <Flex
        h="40px"
        pt="4px"
        align="stretch"
        bg="bg.muted"
        overflow="visible"
        style={dragStyle}
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
        <img src="/icon.png" alt="MarkApp" width={20} height={20} style={{ display: "block", objectFit: "contain" }} />
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
        <TTip label={`New document (${modShortcut("N")})`}>
          <Menu.Root
            positioning={titleBarMenuPositioning}
            onOpenChange={(d) => {
              if (d.open) props.onRefreshRecents();
            }}
          >
            <Menu.Trigger asChild>
              <IconButton
                aria-label="New document"
                size="sm"
                variant="ghost"
                {...chromeGhostIconProps}
                css={{ _icon: { boxSize: "4" } }}
              >
                <FilePlus size={16} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content {...menuContentStyle} minW="200px">
                <Menu.Item value="blank" onSelect={() => props.onNewBlank()}>
                  <Text fontSize="sm">New blank document</Text>
                </Menu.Item>
                <Menu.Item value="tpl" onSelect={() => props.onTemplateNew()}>
                  <Text fontSize="sm">New from template…</Text>
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </TTip>

        <TTip label={`Open file (${modShortcut("O")}) — Browse or recent`}>
          <Menu.Root
            positioning={titleBarMenuPositioning}
            onOpenChange={(d) => {
              if (d.open) props.onRefreshRecents();
            }}
          >
            <Menu.Trigger asChild>
              <IconButton
                aria-label="Open"
                size="sm"
                variant="ghost"
                {...chromeGhostIconProps}
                css={{ _icon: { boxSize: "4" } }}
              >
                <FolderOpen size={16} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content {...menuContentStyle} minW="240px">
                <Menu.Item value="browse" onSelect={() => props.onOpenBrowse()}>
                  <Text fontSize="sm">Browse…</Text>
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
        </TTip>

        <TTip label={saveLabel}>
          <IconButton
            aria-label="Save"
            size="sm"
            variant="ghost"
            {...chromeGhostIconProps}
            onClick={() => props.onSave()}
            css={{ _icon: { boxSize: "4" } }}
          >
            <Save size={16} />
          </IconButton>
        </TTip>

        <TTip label="More — Save as, templates, theme">
          <Menu.Root positioning={titleBarMenuPositioning}>
            <Menu.Trigger asChild>
              <IconButton
                aria-label="More options"
                size="sm"
                variant="ghost"
                {...chromeGhostIconProps}
                css={{ _icon: { boxSize: "4" } }}
              >
                <MoreHorizontal size={16} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content {...menuContentStyle} minW="220px">
                <Menu.Item value="saveas" onSelect={() => props.onSaveAs()}>
                  <HStack justify="space-between" w="full">
                    <HStack gap={2}>
                      <SaveAll size={14} />
                      <Text fontSize="sm">Save as…</Text>
                    </HStack>
                    <Text fontSize="xs" color="fg.muted">
                      {modShortcut("Shift+S")}
                    </Text>
                  </HStack>
                </Menu.Item>
                <Menu.Item value="tmpl" onSelect={() => props.onTemplateManager()}>
                  <HStack gap={2}>
                    <LayoutTemplate size={14} />
                    <Text fontSize="sm">Template manager</Text>
                  </HStack>
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item value="light" onSelect={() => setColorMode("light")}>
                  <HStack gap={2}>
                    <Sun size={14} />
                    <Text fontSize="sm">Use light theme</Text>
                    {colorMode === "light" ? <Text fontSize="xs">✓</Text> : null}
                  </HStack>
                </Menu.Item>
                <Menu.Item value="dark" onSelect={() => setColorMode("dark")}>
                  <HStack gap={2}>
                    <Moon size={14} />
                    <Text fontSize="sm">Use dark theme</Text>
                    {colorMode === "dark" ? <Text fontSize="xs">✓</Text> : null}
                  </HStack>
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </TTip>
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

      <HStack gap={3} pr={0} flexShrink={0} align="center" style={noDragStyle}>
        <TTip label="Settings">
          <IconButton
            aria-label="Settings"
            size="sm"
            variant="ghost"
            {...chromeGhostIconProps}
            onClick={() => props.onSettings()}
            css={{ _icon: { boxSize: "4" } }}
          >
            <Settings size={16} />
          </IconButton>
        </TTip>
        <WindowControls maximized={maximized} />
      </HStack>
      </Flex>
    </Box>
  );
}
