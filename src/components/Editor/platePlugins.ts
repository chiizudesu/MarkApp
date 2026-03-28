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
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from "@platejs/code-block/react";
import { ListPlugin } from "@platejs/list/react";
import { ImagePlugin } from "@platejs/media/react";
import { MarkdownPlugin } from "@platejs/markdown";
import { KEYS } from "platejs";
import { ParagraphPlugin } from "platejs/react";

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
  CodeBlockElement,
  CodeLineElement,
  ImageElement,
  CodeLeaf,
  BoldLeaf,
  ItalicLeaf,
  UnderlineLeaf,
  StrikethroughLeaf,
} from "./plateElements";

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
];

const autoformatLists: AutoformatRule[] = [
  {
    match: ["* ", "- "],
    mode: "block",
    type: "list",
    format: (editor) => {
      (editor as any).tf.list?.toggle?.({ listStyleType: KEYS.ul });
    },
  },
  {
    match: [String.raw`^\d+\.$ `, String.raw`^\d+\)$ `],
    matchByRegex: true,
    mode: "block",
    type: "list",
    format: (editor) => {
      (editor as any).tf.list?.toggle?.({ listStyleType: KEYS.ol });
    },
  },
];

export const editorPlugins = [
  ParagraphPlugin.withComponent(ParagraphElement),

  H1Plugin.configure({
    node: { component: H1Element },
    rules: { break: { empty: "reset" } },
    shortcuts: { toggle: { keys: "mod+alt+1" } },
  }),
  H2Plugin.configure({
    node: { component: H2Element },
    rules: { break: { empty: "reset" } },
    shortcuts: { toggle: { keys: "mod+alt+2" } },
  }),
  H3Plugin.configure({
    node: { component: H3Element },
    rules: { break: { empty: "reset" } },
    shortcuts: { toggle: { keys: "mod+alt+3" } },
  }),
  H4Plugin.configure({
    node: { component: H4Element },
    rules: { break: { empty: "reset" } },
    shortcuts: { toggle: { keys: "mod+alt+4" } },
  }),
  H5Plugin.configure({
    node: { component: H5Element },
    rules: { break: { empty: "reset" } },
    shortcuts: { toggle: { keys: "mod+alt+5" } },
  }),
  H6Plugin.configure({
    node: { component: H6Element },
    rules: { break: { empty: "reset" } },
    shortcuts: { toggle: { keys: "mod+alt+6" } },
  }),

  BlockquotePlugin.configure({
    node: { component: BlockquoteElement },
    shortcuts: { toggle: { keys: "mod+shift+period" } },
  }),

  HorizontalRulePlugin.withComponent(HrElement),

  CodeBlockPlugin.withComponent(CodeBlockElement),
  CodeLinePlugin.withComponent(CodeLineElement),
  CodeSyntaxPlugin,

  ListPlugin,

  ImagePlugin.configure({
    node: { component: ImageElement },
  }),

  BoldPlugin.withComponent(BoldLeaf),
  ItalicPlugin.withComponent(ItalicLeaf),
  UnderlinePlugin.withComponent(UnderlineLeaf),
  StrikethroughPlugin.withComponent(StrikethroughLeaf),
  CodePlugin.withComponent(CodeLeaf),

  MarkdownPlugin,

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
