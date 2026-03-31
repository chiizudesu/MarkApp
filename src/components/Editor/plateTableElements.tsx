import * as React from "react";
import { ResizeHandle } from "@platejs/resizable";
import { getTableColumnCount } from "@platejs/table";
import {
  TableProvider,
  useSelectedCells,
  useTableCellElement,
  useTableCellElementResizable,
  useTableColSizes,
  useTableElement,
  useTableSelectionDom,
} from "@platejs/table/react";
import type { TTableCellElement, TTableElement, TTableRowElement } from "platejs";
import { PlateElement, type PlateElementProps, useReadOnly, withHOC } from "platejs/react";

const DEFAULT_COL_WIDTH = 120;

function borderCss(b?: { size?: number; color?: string; style?: string }): string {
  if (!b || (b.size ?? 0) === 0) return "none";
  const w = b.size ?? 1;
  const s = b.style ?? "solid";
  const c = b.color ?? "var(--markapp-border, #d1d5db)";
  return `${w}px ${s} ${c}`;
}

export const TableElement = withHOC(TableProvider, function TableElement(props: PlateElementProps) {
  useSelectedCells();
  const { marginLeft, props: tableMouseDown } = useTableElement();
  const colSizes = useTableColSizes();
  const tableRef = React.useRef<HTMLTableElement>(null);
  useTableSelectionDom(tableRef);
  const element = props.element as TTableElement;

  const columnCount =
    colSizes.length > 0 ? colSizes.length : Math.max(1, getTableColumnCount(element));
  const resolvedColWidths = React.useMemo(() => {
    if (colSizes.length > 0) return colSizes.map((n) => n || DEFAULT_COL_WIDTH);
    return Array.from({ length: columnCount }, () => DEFAULT_COL_WIDTH);
  }, [colSizes, columnCount]);

  const totalWidth = resolvedColWidths.reduce((a, w) => a + w, 0);

  return (
    <PlateElement
      {...props}
      as="div"
      style={{
        marginLeft,
        marginTop: "0.65em",
        marginBottom: "0.65em",
        overflowX: "auto",
      }}
    >
      <table
        ref={tableRef}
        style={{
          width: `${totalWidth}px`,
          borderCollapse: "collapse",
          tableLayout: "fixed",
        }}
        {...tableMouseDown}
      >
        <colgroup>
          {resolvedColWidths.map((w, i) => (
            <col key={i} style={{ width: `${w}px` }} />
          ))}
        </colgroup>
        <tbody>{props.children}</tbody>
      </table>
    </PlateElement>
  );
});

export function TableRowElement(props: PlateElementProps) {
  const row = props.element as TTableRowElement;
  return (
    <PlateElement
      {...props}
      as="tr"
      style={row.size ? { height: `${row.size}px` } : undefined}
    />
  );
}

const resizeHandleSx: React.CSSProperties = {
  position: "absolute",
  zIndex: 2,
};

function TableCellBase({ as, ...props }: PlateElementProps & { as: "td" | "th" }) {
  const readOnly = useReadOnly();
  const el = props.element as TTableCellElement;
  const cell = useTableCellElement();
  const { borders, colIndex, colSpan, minHeight, rowIndex, selected, width } = cell;
  const resizable = useTableCellElementResizable({ colIndex, colSpan, rowIndex });

  const isHeader = as === "th";
  const outline = selected
    ? "2px solid var(--chakra-colors-blue-500, #3b82f6)"
    : undefined;

  return (
    <PlateElement
      {...props}
      as={as}
      attributes={{
        ...props.attributes,
        "data-table-cell-id": el.id ?? "",
      }}
      style={{
        borderTop: borderCss(borders.top),
        borderRight: borderCss(borders.right),
        borderBottom: borderCss(borders.bottom),
        borderLeft: borderCss(borders.left),
        minHeight,
        width: typeof width === "number" ? width : undefined,
        maxWidth: typeof width === "number" ? width : undefined,
        verticalAlign: "top",
        padding: "6px 10px",
        position: "relative",
        outline,
        outlineOffset: -1,
        backgroundColor: el.background ?? (isHeader ? "var(--markapp-code-bg, rgba(0,0,0,0.04))" : undefined),
        fontWeight: isHeader ? 600 : undefined,
      }}
    >
      {props.children}
      {!readOnly ? (
        <>
          {!resizable.hiddenLeft ? (
            <ResizeHandle
              {...resizable.leftProps}
              style={{
                ...resizeHandleSx,
                left: -2,
                top: 0,
                bottom: 0,
                width: 4,
                cursor: "col-resize",
              }}
            />
          ) : null}
          <ResizeHandle
            {...resizable.rightProps}
            style={{
              ...resizeHandleSx,
              right: -2,
              top: 0,
              bottom: 0,
              width: 4,
              cursor: "col-resize",
            }}
          />
          <ResizeHandle
            {...resizable.bottomProps}
            style={{
              ...resizeHandleSx,
              left: 0,
              right: 0,
              bottom: -2,
              height: 4,
              cursor: "row-resize",
            }}
          />
        </>
      ) : null}
    </PlateElement>
  );
}

export function TableCellElement(props: PlateElementProps) {
  return <TableCellBase {...props} as="td" />;
}

export function TableCellHeaderElement(props: PlateElementProps) {
  return <TableCellBase {...props} as="th" />;
}
