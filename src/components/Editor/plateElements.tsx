import type { TMediaElement } from "platejs";
import { openImagePreview } from "@platejs/media/react";
import { PlateElement, PlateLeaf, useEditorRef, type PlateElementProps, type PlateLeafProps } from "platejs/react";

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
        margin: "0.25em 0",
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
        margin: "0.8em 0 0.4em",
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
        margin: "0.7em 0 0.35em",
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
        margin: "0.6em 0 0.3em",
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
        margin: "0.5em 0 0.25em",
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
        margin: "0.5em 0 0.2em",
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
        margin: "0.4em 0 0.2em",
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
        margin: "0.5em 0",
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

export function ImageElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const element = props.element as TMediaElement;
  return (
    <PlateElement {...props} as="div" style={{ margin: "0.5em 0" }}>
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
  return (
    <PlateElement
      as="pre"
      style={{
        backgroundColor: "var(--markapp-code-bg)",
        borderRadius: "6px",
        padding: "0.75em 1em",
        margin: "0.5em 0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "0.9em",
        lineHeight: 1.6,
        overflowX: "auto",
      }}
      {...props}
    />
  );
}

export function CodeLineElement(props: PlateElementProps) {
  return <PlateElement as="div" {...props} />;
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
