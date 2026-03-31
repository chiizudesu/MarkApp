import type { AutoformatRule } from "@platejs/autoformat";
import {
  autoformatArrow,
  autoformatLegal,
  autoformatLegalHtml,
  autoformatMath,
  AutoformatPlugin,
  autoformatPunctuation,
  autoformatSmartQuotes,
} from "@platejs/autoformat";
import remarkGfm from "remark-gfm";
import {
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  CodePlugin,
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
} from "@platejs/basic-nodes/react";
import {
  FontColorPlugin,
  FontFamilyPlugin,
  FontSizePlugin,
  TextAlignPlugin,
} from "@platejs/basic-styles/react";
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from "@platejs/code-block/react";
import { IndentPlugin } from "@platejs/indent/react";
import { toggleList } from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";
import { ImagePlugin } from "@platejs/media/react";
import { MarkdownPlugin, remarkMdx } from "@platejs/markdown";
import { all, createLowlight } from "lowlight";
import { Element, Text, type Descendant } from "slate";
import { createSlatePlugin, KEYS } from "platejs";
import { ParagraphPlugin, toPlatePlugin } from "platejs/react";

import {
  MARKAPP_MANUAL_SECTION_BLOCK_TYPE,
  MARKAPP_MANUAL_SECTION_MARKER,
} from "@/services/sectionService";
import {
  ParagraphElement,
  H1Element,
  H2Element,
  H3Element,
  H4Element,
  H5Element,
  H6Element,
  BlockquoteElement,
  HrElement,
  MarkappManualSectionElement,
  BlockList,
  CodeBlockElement,
  CodeLineElement,
  CodeSyntaxLeaf,
  ImageElement,
  CodeLeaf,
  BoldLeaf,
  ItalicLeaf,
  UnderlineLeaf,
  StrikethroughLeaf,
} from "./plateElements";
import { tableKitPlugins } from "./plugins/tableKit";

const MANUAL_SECTION_HTML_COMMENT_RE = /^<!--\s*markapp-manual-section\s*-->$/i;

const lowlight = createLowlight(all);

/** Blocks that can participate in indent + Plate indent-list. */
const listIndentInjectTargets = [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock, KEYS.img];

const autoformatMarks: AutoformatRule[] = [
  { match: "***", mode: "mark", type: [KEYS.bold, KEYS.italic] },
  { match: "**", mode: "mark", type: KEYS.bold },
  { match: "*", mode: "mark", type: KEYS.italic },
  { match: "_", mode: "mark", type: KEYS.italic },
  { match: "~~", mode: "mark", type: KEYS.strikethrough },
  { match: "`", mode: "mark", type: KEYS.code },
];

const autoformatBlocks: AutoformatRule[] = [
  { match: "# ", mode: "block", type: KEYS.h1 },
  { match: "## ", mode: "block", type: KEYS.h2 },
  { match: "### ", mode: "block", type: KEYS.h3 },
  { match: "#### ", mode: "block", type: KEYS.h4 },
  { match: "##### ", mode: "block", type: KEYS.h5 },
  { match: "###### ", mode: "block", type: KEYS.h6 },
  { match: "> ", mode: "block", type: KEYS.blockquote },
  {
    match: ["---", "—-", "___ "],
    mode: "block",
    type: KEYS.hr,
    format: (editor) => {
      editor.tf.setNodes({ type: KEYS.hr });
      editor.tf.insertNodes({ children: [{ text: "" }], type: KEYS.p });
    },
  },
  {
    match: "``` ",
    mode: "block",
    type: KEYS.codeBlock,
    preFormat: (editor) => editor.tf.unwrapNodes(),
    format: (editor) => {
      (editor as any).tf.code_block?.toggle?.();
    },
  },
];

/** Inline / style keys cleared on a new empty line so typing starts with default formatting. */
const leafFormatKeys = [
  KEYS.bold,
  KEYS.italic,
  KEYS.underline,
  KEYS.strikethrough,
  KEYS.code,
  KEYS.color,
  KEYS.backgroundColor,
  KEYS.fontFamily,
  KEYS.fontSize,
] as const;

/**
 * After Enter, Slate copies marks onto the new block's text. When that block is empty, strip those
 * marks and the editor's stored marks so the next line starts unformatted (paragraphs, lists, etc.).
 */
const MarkappManualSectionPlugin = toPlatePlugin(
  createSlatePlugin({
    key: MARKAPP_MANUAL_SECTION_BLOCK_TYPE,
    node: { isElement: true, isVoid: true },
  }),
  { render: { node: MarkappManualSectionElement } },
);

const clearFormatsOnEmptyNewLinePlugin = toPlatePlugin(
  createSlatePlugin({
    key: "clearFormatsOnEmptyNewLine",
  }).overrideEditor(({ editor, tf: { insertBreak } }) => ({
    transforms: {
      insertBreak() {
        if (
          editor.api.some({
            match: { type: editor.getType(KEYS.codeBlock) },
          })
        ) {
          insertBreak();
          return;
        }
        const wasCollapsed = editor.selection !== null && editor.api.isCollapsed();
        insertBreak();
        if (!wasCollapsed || !editor.selection || !editor.api.isCollapsed()) return;
        const block = editor.api.block();
        if (!block) return;
        if (!editor.api.isEmpty(editor.selection, { block: true })) return;
        editor.tf.unsetNodes([...leafFormatKeys], {
          at: block[1],
          match: (n: Descendant) => Text.isText(n),
          split: true,
        });
        editor.tf.removeMarks();
      },
    },
  })),
);

const autoformatLists: AutoformatRule[] = [
  {
    match: ["* ", "- "],
    mode: "block",
    type: "list",
    format: (editor) => {
      toggleList(editor, { listStyleType: "disc" });
    },
  },
  {
    match: [String.raw`^\d+\.$ `, String.raw`^\d+\)$ `],
    matchByRegex: true,
    mode: "block",
    type: "list",
    format: (editor) => {
      toggleList(editor, { listStyleType: "decimal" });
    },
  },
];

export const editorPlugins = [
  clearFormatsOnEmptyNewLinePlugin,

  MarkappManualSectionPlugin,

  ParagraphPlugin.withComponent(ParagraphElement),

  H1Plugin.configure({
    node: { component: H1Element },
    rules: { break: { empty: "reset", splitReset: true } },
    shortcuts: { toggle: { keys: "mod+alt+1" } },
  }),
  H2Plugin.configure({
    node: { component: H2Element },
    rules: { break: { empty: "reset", splitReset: true } },
    shortcuts: { toggle: { keys: "mod+alt+2" } },
  }),
  H3Plugin.configure({
    node: { component: H3Element },
    rules: { break: { empty: "reset", splitReset: true } },
    shortcuts: { toggle: { keys: "mod+alt+3" } },
  }),
  H4Plugin.configure({
    node: { component: H4Element },
    rules: { break: { empty: "reset", splitReset: true } },
    shortcuts: { toggle: { keys: "mod+alt+4" } },
  }),
  H5Plugin.configure({
    node: { component: H5Element },
    rules: { break: { empty: "reset", splitReset: true } },
    shortcuts: { toggle: { keys: "mod+alt+5" } },
  }),
  H6Plugin.configure({
    node: { component: H6Element },
    rules: { break: { empty: "reset", splitReset: true } },
    shortcuts: { toggle: { keys: "mod+alt+6" } },
  }),

  BlockquotePlugin.configure({
    node: { component: BlockquoteElement },
    shortcuts: { toggle: { keys: "mod+shift+period" } },
  }),

  HorizontalRulePlugin.withComponent(HrElement),

  CodeBlockPlugin.configure({
    node: { component: CodeBlockElement },
    options: { lowlight, defaultLanguage: "plaintext" },
    shortcuts: { toggle: { keys: "mod+alt+8" } },
  }),
  CodeLinePlugin.withComponent(CodeLineElement),
  CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),

  IndentPlugin.configure({
    inject: { targetPlugins: listIndentInjectTargets },
    options: { offset: 24 },
  }),
  ListPlugin.configure({
    inject: { targetPlugins: listIndentInjectTargets },
    render: { belowNodes: BlockList },
  }),

  ...tableKitPlugins,

  /** Plate table selection indices require a stable `id` on each td/th. */
  toPlatePlugin(
    createSlatePlugin({
      key: "markappTableCellIds",
    }).overrideEditor(({ editor, tf: { normalizeNode } }) => ({
      transforms: {
        normalizeNode(entry, options) {
          const [node, path] = entry;
          if (
            Element.isElement(node) &&
            path.length > 0 &&
            (node.type === editor.getType(KEYS.td) || node.type === editor.getType(KEYS.th)) &&
            !(node as { id?: string }).id
          ) {
            const id =
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `tc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
            editor.tf.setNodes({ id }, { at: path });
            return;
          }
          return normalizeNode(entry, options);
        },
      },
    })),
  ),

  ImagePlugin.configure({
    node: { component: ImageElement },
  }),

  BoldPlugin.withComponent(BoldLeaf),
  ItalicPlugin.withComponent(ItalicLeaf),
  UnderlinePlugin.withComponent(UnderlineLeaf),
  StrikethroughPlugin.withComponent(StrikethroughLeaf),
  CodePlugin.withComponent(CodeLeaf),

  FontColorPlugin.configure({
    inject: {
      targetPlugins: [...KEYS.heading, KEYS.p, KEYS.blockquote],
    },
  }),
  FontFamilyPlugin.configure({
    inject: {
      targetPlugins: [...KEYS.heading, KEYS.p, KEYS.blockquote],
    },
  }),
  FontSizePlugin.configure({
    inject: {
      targetPlugins: [...KEYS.heading, KEYS.p, KEYS.blockquote],
    },
  }),

  TextAlignPlugin.configure({
    inject: {
      targetPlugins: [...KEYS.heading, KEYS.p, KEYS.blockquote],
    },
  }),

  /** GFM + MDX so font color/family/size survive round-trip as `<span style="...">` via @platejs/markdown fontRules. */
  MarkdownPlugin.configure({
    options: {
      remarkPlugins: [remarkGfm, remarkMdx],
      rules: {
        html: {
          deserialize(mdastNode) {
            const v = (mdastNode.value || "").trim();
            if (MANUAL_SECTION_HTML_COMMENT_RE.test(v)) {
              return {
                type: MARKAPP_MANUAL_SECTION_BLOCK_TYPE,
                children: [{ text: "" }],
              };
            }
            return { text: (mdastNode.value || "").split("<br />").join("\n") };
          },
        },
        [MARKAPP_MANUAL_SECTION_BLOCK_TYPE]: {
          serialize: () => ({
            type: "html",
            value: `${MARKAPP_MANUAL_SECTION_MARKER}\n`,
          }),
        },
      },
    },
  }),

  AutoformatPlugin.configure({
    options: {
      enableUndoOnDelete: true,
      rules: [
        ...autoformatBlocks,
        ...autoformatMarks,
        ...autoformatSmartQuotes,
        ...autoformatPunctuation,
        ...autoformatLegal,
        ...autoformatLegalHtml,
        ...autoformatArrow,
        ...autoformatMath,
        ...autoformatLists,
      ].map(
        (rule): AutoformatRule => ({
          ...rule,
          query: (editor) =>
            !editor.api.some({
              match: { type: editor.getType(KEYS.codeBlock) },
            }),
        }),
      ),
    },
  }),
];
