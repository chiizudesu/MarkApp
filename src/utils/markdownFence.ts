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

/**
 * Like {@link stripOuterMarkdownCodeFence} but safe while the closing ``` is still
 * streaming: strips the opening line as soon as it is present and drops a trailing
 * close fence only when the last line is exactly ```.
 */
export function stripStreamingOuterMarkdownCodeFence(text: string): string {
  const lines = text.split(/\r?\n/);
  const first = lines[0]?.trimStart() ?? "";
  if (!first.startsWith("```")) {
    return stripOuterMarkdownCodeFence(text);
  }
  let body = lines.slice(1);
  if (body.length > 0 && body[body.length - 1]?.trim() === "```") {
    body = body.slice(0, -1);
  }
  return body.join("\n");
}

/**
 * Models often omit blank lines after bold pseudo-headings (`**Title**` immediately followed by body text,
 * or only a single newline). That collapses into one paragraph in the editor. Repair before deserialize / apply.
 * Idempotent for typical inputs.
 */
export function normalizeAssistantMarkdownParagraphs(md: string): string {
  if (!md) return md;
  let s = md;

  const gluedBold = /\*\*([^*\n]+)\*\*(?=[A-Za-z\u00C0-\u024F])/g;
  const singleNlBold = /\*\*([^*\n]+)\*\*\r?\n(?![\r\n])(?=\S)/g;
  s = s.replace(gluedBold, "**$1**\n\n");
  s = s.replace(singleNlBold, "**$1**\n\n");

  const gluedUl = /__([^_\n]+)__(?=[A-Za-z\u00C0-\u024F])/g;
  const singleNlUl = /__([^_\n]+)__\r?\n(?![\r\n])(?=\S)/g;
  s = s.replace(gluedUl, "__$1__\n\n");
  s = s.replace(singleNlUl, "__$1__\n\n");

  return s;
}
