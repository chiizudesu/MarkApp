import { Box } from "@chakra-ui/react";
import DiffMatchPatch from "diff-match-patch";
import { useMemo } from "react";

const DIFF_DELETE = -1;
const DIFF_INSERT = 1;
const DIFF_EQUAL = 0;

export function InlineTextDiff(props: { oldText: string; newText: string }) {
  const segments = useMemo(() => {
    const dmp = new DiffMatchPatch();
    const raw = dmp.diff_main(props.oldText, props.newText);
    dmp.diff_cleanupSemantic(raw);
    return raw;
  }, [props.oldText, props.newText]);

  return (
    <Box
      as="span"
      display="block"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      fontSize="xs"
      lineHeight="1.5"
      fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    >
      {segments.map((part, i) => {
        const op = part[0];
        const chunk = part[1];
        if (op === DIFF_EQUAL) {
          return (
            <Box as="span" key={i} color="fg">
              {chunk}
            </Box>
          );
        }
        if (op === DIFF_INSERT) {
          return (
            <Box
              as="span"
              key={i}
              bg={{ _light: "green.100", _dark: "rgba(34, 197, 94, 0.22)" }}
              color="fg"
              borderRadius="sm"
              px="0.5"
            >
              {chunk}
            </Box>
          );
        }
        if (op === DIFF_DELETE) {
          return (
            <Box
              as="span"
              key={i}
              bg={{ _light: "red.100", _dark: "rgba(239, 68, 68, 0.2)" }}
              color="fg"
              textDecoration="line-through"
              borderRadius="sm"
              px="0.5"
            >
              {chunk}
            </Box>
          );
        }
        return null;
      })}
    </Box>
  );
}
