import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import DiffMatchPatch from "diff-match-patch";
import { AlignLeft } from "lucide-react";
import { useMemo } from "react";
import { useColorModeValue } from "@/components/ui/color-mode";

const DIFF_DELETE = -1;
const DIFF_INSERT = 1;

function diffLineStats(oldText: string, newText: string) {
  const dmp = new DiffMatchPatch();
  const raw = dmp.diff_main(oldText, newText);
  dmp.diff_cleanupSemantic(raw);
  let plus = 0;
  let minus = 0;
  for (const [op, chunk] of raw) {
    if (!chunk) continue;
    const lines = chunk.split(/\r?\n/).length;
    if (op === DIFF_DELETE) minus += lines;
    else if (op === DIFF_INSERT) plus += lines;
  }
  return { plus, minus };
}

/** maxHeight sits on Viewport so Radix overflow:scroll kicks in correctly */
const DIFF_MAX_H = "9.5rem";

export function SectionInlineDiffPreview(props: {
  title: string;
  oldText: string;
  newText: string;
  /** Show spinner in header while the model is still writing the draft */
  isGenerating?: boolean;
}) {
  const stats = useMemo(
    () => diffLineStats(props.oldText, props.newText),
    [props.oldText, props.newText],
  );
  const oldLines = props.oldText.split(/\r?\n/);
  const newLines = props.newText.split(/\r?\n/);

  const paneBg = useColorModeValue("#f1f5f9", "#1a202c");
  const headerBorder = useColorModeValue("blackAlpha.100", "whiteAlpha.100");
  const titleColor = useColorModeValue("#334155", "white");
  const generating = Boolean(props.isGenerating);

  return (
    <Box
      borderRadius="lg"
      borderWidth="1px"
      borderColor={{ _light: "blackAlpha.200", _dark: "whiteAlpha.200" }}
      overflow="hidden"
      bg={paneBg}
      aria-busy={generating}
    >
      <Flex
        align="center"
        gap={1.5}
        px={2}
        py={1.5}
        borderBottomWidth="1px"
        borderColor={headerBorder}
      >
        <Box as="span" color="blue.400" display="flex" css={{ flexShrink: 0 }} aria-hidden>
          {generating ? (
            <Spinner size="xs" color="blue.400" />
          ) : (
            <AlignLeft size={12} strokeWidth={2} />
          )}
        </Box>
        <Text
          fontSize="11px"
          fontWeight="semibold"
          letterSpacing={0.45}
          color={titleColor}
          flex="1"
          minW={0}
          truncate
          title={props.title}
        >
          {props.title}
        </Text>
        <Flex align="center" gap={1} fontSize="10px" fontFamily="mono" flexShrink={0}>
          <Text as="span" color="green.500" _dark={{ color: "green.400" }}>
            +{stats.plus}
          </Text>
          <Text as="span" color="red.500" _dark={{ color: "red.400" }}>
            -{stats.minus}
          </Text>
        </Flex>
      </Flex>

      {/*
       * Root: overflow hidden + position:relative (Radix default).
       * NO padding here — padding on Root shifts the absolute-positioned
       * Scrollbar track off-axis.
       * Viewport: maxHeight here so Radix's internal overflow:scroll fires
       * correctly (maxHeight on Root with height:100% Viewport never scrolls).
       */}
      <ScrollArea.Root
        type="always"
        className="inline-diff-scroll-area"
        style={{ overflow: "hidden" }}
      >
        <ScrollArea.Viewport
          style={{ maxHeight: DIFF_MAX_H, width: "100%" }}
        >
          <Box
            fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
            fontSize="11px"
            lineHeight="1.45"
            p={1.5}
            pr={3}
          >
            {/* Removed section — one red block for all old lines */}
            <Box
              mb={1.5}
              borderLeftWidth="2px"
              borderLeftColor={{ _light: "red.400", _dark: "red.500" }}
              bg={{ _light: "red.50", _dark: "rgba(239, 68, 68, 0.12)" }}
              borderRadius="sm"
              px={1.5}
              py={1}
            >
              {oldLines.map((line, i) => (
                <Box
                  key={`o-${i}`}
                  whiteSpace="pre-wrap"
                  wordBreak="break-word"
                  color={{ _light: "red.800", _dark: "red.300" }}
                >
                  {line.length ? line : "\u00a0"}
                </Box>
              ))}
            </Box>

            {/* Inserted section — one green block for all new lines */}
            <Box
              borderLeftWidth="2px"
              borderLeftColor={{ _light: "green.500", _dark: "green.400" }}
              bg={{ _light: "green.50", _dark: "rgba(34, 197, 94, 0.12)" }}
              borderRadius="sm"
              px={1.5}
              py={1}
            >
              {newLines.map((line, i) => (
                <Box
                  key={`n-${i}`}
                  whiteSpace="pre-wrap"
                  wordBreak="break-word"
                  color={{ _light: "green.800", _dark: "green.300" }}
                >
                  {line.length ? line : "\u00a0"}
                </Box>
              ))}
            </Box>
          </Box>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical">
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </Box>
  );
}
