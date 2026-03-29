import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { Dialog, Portal, Input, Box, VStack, Button, Text, HStack } from "@chakra-ui/react";

export type CommandCategory = "File" | "Edit" | "View" | "AI";

export type CommandItem = {
  id: string;
  label: string;
  category: CommandCategory;
  keywords?: string[];
  shortcut?: string;
  icon?: ReactNode;
  run: () => void;
};

const CATEGORY_ORDER: CommandCategory[] = ["File", "Edit", "View", "AI"];

export function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
}) {
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (props.open) {
      setQ("");
      setHighlight(0);
    }
  }, [props.open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s
      ? props.commands.filter((c) => {
          const hay = `${c.label} ${(c.keywords ?? []).join(" ")}`.toLowerCase();
          return hay.includes(s);
        })
      : [...props.commands];
    const rank = (x: CommandCategory) => CATEGORY_ORDER.indexOf(x);
    base.sort((a, b) => rank(a.category) - rank(b.category) || a.label.localeCompare(b.label));
    return base;
  }, [props.commands, q]);

  useEffect(() => {
    setHighlight((h) => (filtered.length ? Math.min(h, filtered.length - 1) : 0));
  }, [filtered.length, q]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const runAt = (i: number) => {
    const cmd = filtered[i];
    if (!cmd) return;
    cmd.run();
    props.onClose();
  };

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(e) => {
        if (!e.open) props.onClose();
      }}
      placement="center"
    >
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.600" />
        <Dialog.Positioner>
          <Dialog.Content maxW="460px" w="90vw" p={0}>
            <Box p={3} borderBottomWidth="1px">
              <Text fontSize="sm" fontWeight="semibold" mb={2}>
                Command palette
              </Text>
              <Input
                placeholder="Type a command…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                size="sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => (filtered.length ? (h + 1) % filtered.length : 0));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => (filtered.length ? (h - 1 + filtered.length) % filtered.length : 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    runAt(highlight);
                  }
                }}
              />
            </Box>
            <VStack ref={listRef} align="stretch" maxH="320px" overflowY="auto" p={2} gap={0}>
              {(() => {
                let prev: CommandCategory | null = null;
                return filtered.map((c, i) => {
                  const showHeader = c.category !== prev;
                  prev = c.category;
                  const isHi = i === highlight;
                  return (
                    <Box key={c.id} mb={showHeader ? 2 : 0}>
                      {showHeader ? (
                        <Text fontSize="10px" fontWeight="bold" color="fg.muted" px={2} py={1} letterSpacing="wider">
                          {c.category.toUpperCase()}
                        </Text>
                      ) : null}
                      <Button
                        data-cmd-index={i}
                        size="sm"
                        variant={isHi ? "subtle" : "ghost"}
                        colorPalette={isHi ? "blue" : "gray"}
                        justifyContent="flex-start"
                        fontWeight="normal"
                        h="auto"
                        py={2}
                        mb={0.5}
                        onClick={() => runAt(i)}
                        onMouseEnter={() => setHighlight(i)}
                      >
                        <HStack w="full" justify="space-between" gap={2}>
                          <HStack gap={2} minW={0}>
                            {c.icon ? <Box flexShrink={0}>{c.icon}</Box> : null}
                            <Text truncate>{c.label}</Text>
                          </HStack>
                          {c.shortcut ? (
                            <Text fontSize="xs" color="fg.muted" flexShrink={0}>
                              {c.shortcut}
                            </Text>
                          ) : null}
                        </HStack>
                      </Button>
                    </Box>
                  );
                });
              })()}
              {filtered.length === 0 && (
                <Text fontSize="xs" color="gray.500" px={2}>
                  No matches
                </Text>
              )}
            </VStack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
