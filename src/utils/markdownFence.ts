/**
 * If the model wrapped the entire reply in a single markdown fence, unwrap it so
 * react-markdown renders headings/lists instead of a single code block.
 */
export function stripOuterMarkdownCodeFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  const lines = t.split("\n");
  if (lines.length < 3) return t;
  const open = lines[0];
  if (!open.startsWith("```")) return t;
  if (lines[lines.length - 1].trim() !== "```") return t;
  return lines.slice(1, -1).join("\n").trimEnd();
}
