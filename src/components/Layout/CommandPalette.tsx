import { useMemo, useState, useEffect } from "react";
import {
  Dialog,
  Portal,
  Input,
  Box,
  VStack,
  Button,
  Text,
} from "@chakra-ui/react";

export type CommandItem = {
  id: string;
  label: string;
  keywords?: string[];
  run: () => void;
};

export function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (props.open) setQ("");
  }, [props.open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return props.commands;
    return props.commands.filter((c) => {
      const hay = `${c.label} ${(c.keywords ?? []).join(" ")}`.toLowerCase();
      return hay.includes(s);
    });
  }, [props.commands, q]);

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
          <Dialog.Content maxW="420px" w="90vw" p={0}>
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
                  if (e.key === "Enter" && filtered[0]) {
                    filtered[0].run();
                    props.onClose();
                  }
                }}
              />
            </Box>
            <VStack align="stretch" maxH="280px" overflowY="auto" p={2} gap={1}>
              {filtered.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant="ghost"
                  justifyContent="flex-start"
                  fontWeight="normal"
                  onClick={() => {
                    c.run();
                    props.onClose();
                  }}
                >
                  {c.label}
                </Button>
              ))}
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
