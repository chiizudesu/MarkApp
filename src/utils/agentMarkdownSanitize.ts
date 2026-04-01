import { normalizeAssistantMarkdownParagraphs } from "@/utils/markdownFence";
import { htmlToGfmMarkdown } from "@/utils/htmlToGfmMarkdown";

/**
 * If the model returned HTML instead of markdown, convert to GFM so Plate + remark stay canonical.
 */
export function sanitizeAssistantMarkdownOutput(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const looksHtml =
    trimmed.startsWith("<") &&
    !trimmed.startsWith("<!--") &&
    /<[a-zA-Z][\w:-]*(\s[^>]*)?>/.test(trimmed) &&
    /<\/?(table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|p|div|blockquote|pre|span|strong|b|em|i|a)\b/i.test(
      trimmed,
    );

  if (looksHtml) {
    const conv = htmlToGfmMarkdown(trimmed, trimmed);
    if (conv.ok && conv.markdown.trim().length > 0) {
      return normalizeAssistantMarkdownParagraphs(conv.markdown);
    }
  }

  return normalizeAssistantMarkdownParagraphs(text);
}
