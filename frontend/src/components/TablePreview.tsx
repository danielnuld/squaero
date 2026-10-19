import type { ParsedTable } from "../utils/importers";
import type { ResultSet } from "../utils/query";
import { ResultGrid } from "./ResultGrid";

/**
 * A wizard's preview of rows (import source, generated sample, data-sync
 * result) in the app's own grid (#692): the same header, NULL drawing and
 * virtualization as a table tab, so every row can be scrolled, not five.
 */
export function TablePreview(props: { title: string; table: ParsedTable | ResultSet }) {
  const result = (): ResultSet => {
    const tb = props.table;
    if ("columns" in tb) return tb;
    return {
      columns: tb.headers.map((name) => ({ name, type: "text" })),
      rows: tb.rows,
      truncated: false,
      rowsAffected: 0,
    };
  };
  return (
    <section class="wiz-preview" aria-label={props.title}>
      <h3 class="import-subtitle">{props.title}</h3>
      <div class="wiz-preview-grid">
        <ResultGrid result={result()} loading={false} error={null} />
      </div>
    </section>
  );
}
