import { useCallback, useState, type CSSProperties } from "react";
import type { TCodeBlockElement, TListElement, TMediaElement } from "platejs";
import { NodeApi } from "platejs";
import { isOrderedList } from "@platejs/list";
import { openImagePreview } from "@platejs/media/react";
import {
  PlateElement,
  PlateLeaf,
  useEditorRef,
  useReadOnly,
  type PlateElementProps,
  type PlateLeafProps,
  type RenderNodeWrapper,
} from "platejs/react";
import { Check, Copy } from "lucide-react";

/** Subset of languages supported by lowlight + common in Markdown. */
export const CODE_BLOCK_LANGUAGES: { label: string; value: string }[] = [
  { label: "Plain text", value: "plaintext" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "JSON", value: "json" },
  { label: "HTML", value: "html" },
  { label: "CSS", value: "css" },
  { label: "SCSS", value: "scss" },
  { label: "Markdown", value: "markdown" },
  { label: "Python", value: "python" },
  { label: "Rust", value: "rust" },
  { label: "Go", value: "go" },
  { label: "C", value: "c" },
  { label: "C++", value: "cpp" },
  { label: "C#", value: "csharp" },
  { label: "Java", value: "java" },
  { label: "Kotlin", value: "kotlin" },
  { label: "Swift", value: "swift" },
  { label: "Ruby", value: "ruby" },
  { label: "PHP", value: "php" },
  { label: "Shell", value: "bash" },
  { label: "SQL", value: "sql" },
  { label: "YAML", value: "yaml" },
  { label: "TOML", value: "toml" },
  { label: "XML", value: "xml" },
  { label: "GraphQL", value: "graphql" },
  { label: "Dockerfile", value: "dockerfile" },
];

const toolbarBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "2px 6px",
  fontSize: "11px",
  borderRadius: "4px",
  border: "1px solid var(--markapp-border)",
  background: "var(--markapp-bg, transparent)",
  color: "var(--markapp-fg)",
  cursor: "pointer",
};

const selectStyle: CSSProperties = {
  ...toolbarBtnStyle,
  padding: "2px 4px",
  maxWidth: "140px",
};

/**
 * Renders ol/ul/li around indented list blocks (Plate indent list).
 * @see https://platejs.org/docs/list
 */
export const BlockList: RenderNodeWrapper = (props) => {
  if (!props.element.listStyleType) return;
  return (childProps) => <ListItemWrap {...childProps} />;
};

function ListItemWrap(props: PlateElementProps) {
  const { listStart, listStyleType } = props.element as TListElement;
  const ListTag = isOrderedList(props.element) ? "ol" : "ul";
  return (
    <ListTag
      style={{
        listStyleType,
        margin: 0,
        padding: 0,
        position: "relative",
      }}
      start={ListTag === "ol" ? listStart : undefined}
    >
      <li>{props.children}</li>
    </ListTag>
  );
}

export function ParagraphElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="div"
      attributes={{
        ...props.attributes,
        role: "paragraph",
      }}
      style={{
        marginTop: "0.25em",
        marginBottom: "0.25em",
        lineHeight: 1.7,
      }}
    />
  );
}

export function H1Element(props: PlateElementProps) {
  return (
    <PlateElement
      as="h1"
      style={{
        fontSize: "2em",
        fontWeight: 700,
        lineHeight: 1.2,
        marginTop: "0.8em",
        marginBottom: "0.4em",
        borderBottom: "1px solid var(--markapp-border)",
        paddingBottom: "0.25em",
      }}
      {...props}
    />
  );
}

export function H2Element(props: PlateElementProps) {
  return (
    <PlateElement
      as="h2"
      style={{
        fontSize: "1.5em",
        fontWeight: 700,
        lineHeight: 1.25,
        marginTop: "0.7em",
        marginBottom: "0.35em",
        borderBottom: "1px solid var(--markapp-border)",
        paddingBottom: "0.2em",
      }}
      {...props}
    />
  );
}

export function H3Element(props: PlateElementProps) {
  return (
    <PlateElement
      as="h3"
      style={{
        fontSize: "1.25em",
        fontWeight: 600,
        lineHeight: 1.3,
        marginTop: "0.6em",
        marginBottom: "0.3em",
      }}
      {...props}
    />
  );
}

export function H4Element(props: PlateElementProps) {
  return (
    <PlateElement
      as="h4"
      style={{
        fontSize: "1.1em",
        fontWeight: 600,
        lineHeight: 1.35,
        marginTop: "0.5em",
        marginBottom: "0.25em",
      }}
      {...props}
    />
  );
}

export function H5Element(props: PlateElementProps) {
  return (
    <PlateElement
      as="h5"
      style={{
        fontSize: "1em",
        fontWeight: 600,
        lineHeight: 1.4,
        marginTop: "0.5em",
        marginBottom: "0.2em",
      }}
      {...props}
    />
  );
}

export function H6Element(props: PlateElementProps) {
  return (
    <PlateElement
      as="h6"
      style={{
        fontSize: "0.9em",
        fontWeight: 600,
        lineHeight: 1.4,
        marginTop: "0.4em",
        marginBottom: "0.2em",
        color: "var(--markapp-muted)",
      }}
      {...props}
    />
  );
}

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="blockquote"
      style={{
        borderLeft: "3px solid var(--markapp-accent)",
        marginTop: "0.5em",
        marginBottom: "0.5em",
        paddingLeft: "1em",
        color: "var(--markapp-muted)",
        fontStyle: "italic",
      }}
      {...props}
    />
  );
}

export function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props}>
      <hr
        style={{
          border: "none",
          borderTop: "1px solid var(--markapp-border)",
          margin: "1.5em 0",
        }}
      />
      {props.children}
    </PlateElement>
  );
}

/** Invisible void block; markdown round-trip is `<!--markapp-manual-section-->`. */
export function MarkappManualSectionElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="div">
      <div
        contentEditable={false}
        aria-hidden
        style={{
          height: 0,
          margin: 0,
          padding: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      />
      {props.children}
    </PlateElement>
  );
}

export function ImageElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const element = props.element as TMediaElement;
  return (
    <PlateElement {...props} as="div" style={{ marginTop: "0.5em", marginBottom: "0.5em" }}>
      <img
        alt=""
        contentEditable={false}
        draggable
        src={element.url}
        style={{ maxWidth: "100%", height: "auto", display: "block" }}
        onDoubleClickCapture={() => openImagePreview(editor, element)}
      />
      {props.children}
    </PlateElement>
  );
}

export function CodeBlockElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const readOnly = useReadOnly();
  const element = props.element as TCodeBlockElement;
  const [copied, setCopied] = useState(false);

  const lang = element.lang ?? "plaintext";

  const setLang = useCallback(
    (value: string) => {
      const at = editor.api.findPath(element);
      if (!at) return;
      editor.tf.setNodes({ lang: value }, { at });
    },
    [editor, element],
  );

  const copyAll = useCallback(() => {
    const text = NodeApi.string(element);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [element]);

  return (
    <PlateElement
      {...props}
      as="pre"
      style={{
        position: "relative",
        backgroundColor: "var(--markapp-code-bg)",
        borderRadius: "6px",
        padding: "2rem 1em 0.75em",
        marginTop: "0.5em",
        marginBottom: "0.5em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "0.9em",
        lineHeight: 1.6,
        overflowX: "auto",
      }}
    >
      <div
        contentEditable={false}
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          display: "flex",
          alignItems: "center",
          gap: 6,
          zIndex: 1,
        }}
      >
        {!readOnly && (
          <select
            aria-label="Code language"
            value={CODE_BLOCK_LANGUAGES.some((l) => l.value === lang) ? lang : "plaintext"}
            style={selectStyle}
            onChange={(e) => setLang(e.target.value)}
          >
            {CODE_BLOCK_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" aria-label="Copy code" style={toolbarBtnStyle} onClick={copyAll}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      {props.children}
    </PlateElement>
  );
}

export function CodeLineElement(props: PlateElementProps) {
  return <PlateElement as="div" {...props} style={{ whiteSpace: "pre-wrap", ...props.style }} />;
}

export function CodeSyntaxLeaf(props: PlateLeafProps) {
  const leaf = props.leaf as { className?: string };
  return (
    <PlateLeaf
      {...props}
      as="span"
      className={leaf.className}
      style={leaf.className ? undefined : { color: "inherit" }}
    />
  );
}

export function BoldLeaf(props: PlateLeafProps) {
  return <PlateLeaf as="strong" {...props} />;
}

export function ItalicLeaf(props: PlateLeafProps) {
  return <PlateLeaf as="em" {...props} />;
}

export function UnderlineLeaf(props: PlateLeafProps) {
  return <PlateLeaf as="u" {...props} />;
}

export function StrikethroughLeaf(props: PlateLeafProps) {
  return <PlateLeaf as="s" {...props} />;
}

export function CodeLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf
      as="code"
      style={{
        backgroundColor: "var(--markapp-code-bg)",
        borderRadius: "3px",
        padding: "0.15em 0.3em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "0.9em",
      }}
      {...props}
    />
  );
}
