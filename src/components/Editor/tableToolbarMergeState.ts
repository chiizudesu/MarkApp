import { getSelectedCellEntries, getSelectedCellsBoundingBox } from "@platejs/table";
import { TablePlugin } from "@platejs/table/react";
import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";

/**
 * Mirrors {@link useTableMergeState} from `@platejs/table/react` for use outside `<Plate>`
 * (e.g. app toolbar). Pass `readOnly` when the editor is not editable.
 */
export function tableToolbarMergeState(editor: PlateEditor, readOnly: boolean) {
  const disableMerge = editor.getOptions(TablePlugin).disableMerge;
  if (disableMerge) {
    return { canMerge: false, canSplit: false };
  }
  const api = editor.getApi(TablePlugin);
  const inTable = editor.api.some({ match: { type: KEYS.table } });
  const selectionExpanded = editor.api.isExpanded();
  const collapsed = !readOnly && inTable && !selectionExpanded;
  const selectedCellEntries = getSelectedCellEntries(editor);

  let isRectangularSelection = false;
  if (selectedCellEntries.length > 1) {
    const selectedCells = selectedCellEntries.map(([cell]) => cell);
    const { maxCol, maxRow, minCol, minRow } = getSelectedCellsBoundingBox(editor, selectedCells);
    isRectangularSelection =
      selectedCells.reduce(
        (total, cell) => total + api.table.getColSpan(cell) * api.table.getRowSpan(cell),
        0,
      ) === (maxCol - minCol + 1) * (maxRow - minRow + 1);
  }

  return {
    canMerge:
      !readOnly &&
      inTable &&
      selectionExpanded &&
      selectedCellEntries.length > 1 &&
      isRectangularSelection,
    canSplit:
      collapsed &&
      selectedCellEntries.length === 1 &&
      (api.table.getColSpan(selectedCellEntries[0][0]) > 1 ||
        api.table.getRowSpan(selectedCellEntries[0][0]) > 1),
  };
}
