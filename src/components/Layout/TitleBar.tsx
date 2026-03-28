import { useEffect, useState, type CSSProperties } from "react";
import { Flex, Text, IconButton, HStack } from "@chakra-ui/react";
import { ColorModeButton } from "@/components/ui/color-mode";
import {
  FilePlus,
  FolderOpen,
  Save,
  SaveAll,
  Settings,
  Sparkles,
  LayoutTemplate,
  Minus,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";

const dragStyle: CSSProperties = { WebkitAppRegion: "drag" };
const noDragStyle: CSSProperties = { WebkitAppRegion: "no-drag" };

function WindowControls(props: { maximized: boolean }) {
  const api = window.markAPI;
  if (!api) return null;
  const ctrl = {
    h: "32px",
    w: "46px",
    minW: "46px",
    flexShrink: 0,
    borderRadius: 0,
    color: "fg.muted",
    style: noDragStyle,
  } as const;
  return (
    <HStack gap={0} h="32px" align="stretch" flexShrink={0} style={noDragStyle} ml={1}>
      <IconButton
        {...ctrl}
        aria-label="Minimize"
        variant="ghost"
        onClick={() => api.windowMinimize()}
        css={{ "& svg": { boxSize: "3.5" } }}
        _hover={{ bg: "bg.emphasized" }}
      >
        <Minus strokeWidth={1.75} />
      </IconButton>
      <IconButton
        {...ctrl}
        aria-label={props.maximized ? "Restore" : "Maximize"}
        variant="ghost"
        onClick={() => api.windowToggleMaximize()}
        css={{ "& svg": { boxSize: "13px" } }}
        _hover={{ bg: "bg.emphasized" }}
      >
        {props.maximized ? <Minimize2 strokeWidth={1.75} /> : <Maximize2 strokeWidth={1.75} />}
      </IconButton>
      <IconButton
        {...ctrl}
        aria-label="Close"
        variant="ghost"
        onClick={() => api.windowClose()}
        css={{ "& svg": { boxSize: "3.5" } }}
        transition="background 0.12s ease, color 0.12s ease"
        _hover={{ bg: "red.600", color: "white" }}
      >
        <X strokeWidth={1.75} />
      </IconButton>
    </HStack>
  );
}

export function TitleBar(props: {
  title: string;
  dirty: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onTemplateNew: () => void;
  onSettings: () => void;
  onTemplateManager: () => void;
}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = window.markAPI;
    if (!api) return;
    void api.windowIsMaximized().then(setMaximized);
    return api.subscribeWindowMaximized(setMaximized);
  }, []);

  const onTitleBarDoubleClick = () => {
    window.markAPI?.windowToggleMaximize();
  };

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
      <HStack gap={0} px={1} flexShrink={0} align="center" borderRightWidth="1px" borderColor="border.muted" style={noDragStyle}>
        <IconButton aria-label="New document" size="sm" variant="ghost" onClick={props.onNew} css={{ _icon: { boxSize: "4" } }}>
          <FilePlus size={16} />
        </IconButton>
        <IconButton
          aria-label="New from template"
          size="sm"
          variant="ghost"
          onClick={props.onTemplateNew}
          css={{ _icon: { boxSize: "4" } }}
        >
          <Sparkles size={16} />
        </IconButton>
        <IconButton aria-label="Open" size="sm" variant="ghost" onClick={props.onOpen} css={{ _icon: { boxSize: "4" } }}>
          <FolderOpen size={16} />
        </IconButton>
        <IconButton aria-label="Save" size="sm" variant="ghost" onClick={props.onSave} css={{ _icon: { boxSize: "4" } }}>
          <Save size={16} />
        </IconButton>
        <IconButton aria-label="Save as" size="sm" variant="ghost" onClick={props.onSaveAs} css={{ _icon: { boxSize: "4" } }}>
          <SaveAll size={16} />
        </IconButton>
        <IconButton
          aria-label="Templates"
          size="sm"
          variant="ghost"
          onClick={props.onTemplateManager}
          css={{ _icon: { boxSize: "4" } }}
        >
          <LayoutTemplate size={16} />
        </IconButton>
        <IconButton aria-label="Settings" size="sm" variant="ghost" onClick={props.onSettings} css={{ _icon: { boxSize: "4" } }}>
          <Settings size={16} />
        </IconButton>
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
        <ColorModeButton size="sm" variant="ghost" borderRadius="none" h="32px" w="40px" css={{ _icon: { boxSize: "4" } }} />
        <WindowControls maximized={maximized} />
      </HStack>
    </Flex>
  );
}
