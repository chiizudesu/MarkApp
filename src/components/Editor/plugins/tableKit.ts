import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from "@platejs/table/react";

import {
  TableCellElement,
  TableCellHeaderElement,
  TableElement,
  TableRowElement,
} from "../plateTableElements";

/**
 * Matches Plate docs: {@link https://platejs.org/docs/table TableKit} /
 * “Configure Plugins” (same four plugins, shared UI components).
 */
export const tableKitPlugins = [
  TablePlugin.configure({
    node: { component: TableElement },
    options: {
      initialTableWidth: 600,
      disableMerge: false,
      minColumnWidth: 48,
    },
  }),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
];
