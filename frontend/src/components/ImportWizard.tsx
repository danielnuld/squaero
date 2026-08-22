import { For, Show, createSignal, onMount } from "solid-js";
import { Panel } from "./Panel";
import { schemaDescribe } from "../utils/schema";
import { rowInsert, txBegin, txCommit, txRollback } from "../utils/edit";
import { QueryError } from "../utils/query";
import {
  parseFile,
  parseClipboard,
  emptyAsNull,
  autoMap,
  hasMapping,
  runImport,
  type ColumnMapping,
  type ErrorPolicy,
  type ImportOps,
  type ImportSummary,
  type ParsedTable,
} from "../utils/importers";
import { openWorkbook, isXlsxName, type XlsxWorkbook } from "../utils/xlsxRead";

const PREVIEW_ROWS = 5;
const OMIT = ""; // select value meaning "leave this column unset"

/**
 * Import wizard (issues #31/#32): pick a CSV/JSON file, map its columns onto the
 * target table's columns, choose an error policy, and load the rows inside a
 * transaction (reusing the row.insert + tx.* path from M7). The parsing, mapping
 * and transactional apply are the pure helpers in utils/importers.ts; this
 * component is the modal that drives them and shows the final summary.
 */
export function ImportWizard(props: {
  connId: string;
  target: { table: string; db?: string; schema?: string };
  /**
   * Delimited text to start from instead of a file (issue #383): what was on
   * the clipboard when the user pasted over the grid. The wizard opens on its
   * clipboard tab with this already parsed and mapped — the preview and the
   * transactional apply are the same ones a file goes through, because pasting
   * into someone's database is not a thing to do with less ceremony than that.
   */
  initialText?: string;
  onClose: () => void;
  onImported?: () => void;
}) {
  const [targetCols, setTargetCols] = createSignal<string[]>([]);
  const [parsed, setParsed] = createSignal<ParsedTable | null>(null);
  const [fileName, setFileName] = createSignal("");
  const [mapping, setMapping] = createSignal<ColumnMapping>({});
  // XLSX workbooks carry multiple sheets; keep the opened workbook + the chosen
  // sheet so switching sheets re-reads without re-opening the file (issue #142).
  const [workbook, setWorkbook] = createSignal<XlsxWorkbook | null>(null);
  const [sheetName, setSheetName] = createSignal("");
  const [policy, setPolicy] = createSignal<ErrorPolicy>("skip");
  /** Where the rows come from: a file on disk, or delimited text pasted in. */
  const [source, setSource] = createSignal<"file" | "clipboard">(
    props.initialText ? "clipboard" : "file",
  );
  const [pasted, setPasted] = createSignal(props.initialText ?? "");
  /** Delimited text has no NULL; the user says which empty cells are one. */
  const [blankIsNull, setBlankIsNull] = createSignal(true);
  const [running, setRunning] = createSignal(false);
  const [summary, setSummary] = createSignal<ImportSummary | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const desc = await schemaDescribe(
        props.connId,
        props.target.table,
        props.target.db,
        props.target.schema,
      );
      const nameIdx = desc.columns.findIndex((c) => c.name === "name");
      const names =
        nameIdx === -1
          ? []
          : desc.rows
              .map((r) => r[nameIdx])
              .filter((n): n is string => n !== null);
      setTargetCols(names);
      // Text pasted in before the describe came back was mapped against an
      // empty column list; now that the columns are here, map it properly.
      const already = parsed();
      if (already) setMapping(autoMap(already.headers, names));
    } catch (err) {
      setError(err instanceof QueryError ? err.message : String(err));
    }
  });

  // Load a parsed table into the mapping UI (shared by every source).
  const useTable = (table: ParsedTable) => {
    setParsed(table);
    setMapping(autoMap(table.headers, targetCols()));
  };

  /** Re-read the pasted text. Cheap enough to redo on every keystroke. */
  const usePasted = (text: string) => {
    setPasted(text);
    setError(null);
    setSummary(null);
    if (text.trim() === "") {
      setParsed(null);
      return;
    }
    useTable(parseClipboard(text));
  };

  if (props.initialText) useTable(parseClipboard(props.initialText));

  /** What actually gets imported: the parsed rows, with the NULL rule applied. */
  const effective = (): ParsedTable | null => {
    const table = parsed();
    if (!table) return null;
    return source() === "clipboard" && blankIsNull() ? emptyAsNull(table) : table;
  };

  // Switch the active sheet of the opened workbook, re-reading it.
  const selectSheet = (name: string) => {
    const wb = workbook();
    if (!wb) return;
    setSheetName(name);
    useTable(wb.read(name));
  };

  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    setSummary(null);
    try {
      if (isXlsxName(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const wb = openWorkbook(bytes);
        if (wb.sheets.length === 0) {
          throw new Error("El archivo XLSX no contiene hojas.");
        }
        setWorkbook(wb);
        setFileName(file.name);
        const first = wb.sheets[0].name;
        setSheetName(first);
        useTable(wb.read(first));
      } else {
        const text = await file.text();
        const table = parseFile(file.name, text);
        setWorkbook(null);
        setSheetName("");
        setFileName(file.name);
        useTable(table);
      }
    } catch (err) {
      setParsed(null);
      setWorkbook(null);
      setError(`No se pudo leer el archivo: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const setColumn = (target: string, source: string) =>
    setMapping((m) => ({ ...m, [target]: source === OMIT ? null : source }));

  const runNow = async () => {
    const table = effective();
    if (!table || !hasMapping(mapping())) return;
    setRunning(true);
    setError(null);
    const ops: ImportOps = {
      begin: () => txBegin(props.connId),
      commit: () => txCommit(props.connId),
      rollback: () => txRollback(props.connId),
      insert: async (values) => {
        await rowInsert(props.connId, props.target, values, false);
      },
    };
    try {
      const result = await runImport(table, mapping(), policy(), ops);
      setSummary(result);
      if (result.inserted > 0) {
        props.onImported?.();
      }
    } catch (err) {
      // A transaction-control failure (begin/commit) rather than a row error.
      setError(err instanceof QueryError ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Panel wide onClose={props.onClose}>
        <h2>Importar a {props.target.table}</h2>

        <Show when={error()}>
          <div class="grid-error" role="alert">
            {error()}
          </div>
        </Show>

        <Show
          when={!summary()}
          fallback={
            <div class="import-summary">
              <p>
                <strong>{summary()!.inserted}</strong> fila(s) insertada(s)
                {summary()!.aborted
                  ? " — abortado, no se aplicó ningún cambio."
                  : summary()!.errors.length > 0
                    ? `, ${summary()!.errors.length} con error (omitidas).`
                    : "."}
              </p>
              <Show when={summary()!.errors.length > 0}>
                <ul class="import-errors">
                  <For each={summary()!.errors.slice(0, 20)}>
                    {(e) => (
                      <li>
                        Fila {e.row + 1}: {e.message}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <div class="modal-actions">
                <button class="primary" onClick={props.onClose}>
                  Cerrar
                </button>
              </div>
            </div>
          }
        >
          <div class="import-source" role="radiogroup" aria-label="Origen de los datos">
            <button
              class={`chip ${source() === "file" ? "active" : ""}`}
              role="radio"
              aria-checked={source() === "file"}
              onClick={() => setSource("file")}
            >
              Archivo
            </button>
            <button
              class={`chip ${source() === "clipboard" ? "active" : ""}`}
              role="radio"
              aria-checked={source() === "clipboard"}
              onClick={() => {
                setSource("clipboard");
                usePasted(pasted());
              }}
            >
              Portapapeles
            </button>
          </div>

          <Show when={source() === "file"}>
            <div class="import-field">
              <label>
                Archivo (CSV, JSON o XLSX):{" "}
                <input
                  type="file"
                  accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={onFile}
                />
              </label>
            </div>
          </Show>

          {/* A textarea rather than navigator.clipboard.readText(): reading the
              clipboard needs a permission the webview may simply deny, while
              pasting INTO a field always works and is the gesture people already
              have in their fingers. */}
          <Show when={source() === "clipboard"}>
            <div class="import-field">
              <label class="import-paste-label" for="import-paste">
                Pega aquí las filas (TSV de una hoja de cálculo, o CSV):
              </label>
              <textarea
                id="import-paste"
                class="import-paste"
                rows="6"
                spellcheck={false}
                placeholder={"id\tnombre\tciudad\n1\tMaría\tHermosillo"}
                value={pasted()}
                onInput={(e) => usePasted(e.currentTarget.value)}
              />
            </div>
            <label class="import-field import-check">
              <input
                type="checkbox"
                checked={blankIsNull()}
                onChange={(e) => setBlankIsNull(e.currentTarget.checked)}
              />{" "}
              Las celdas vacías son NULL
            </label>
          </Show>

          <Show when={workbook() && workbook()!.sheets.length > 1}>
            <div class="import-field">
              <label>
                Hoja:{" "}
                <select
                  class="map-select"
                  value={sheetName()}
                  onChange={(e) => selectSheet(e.currentTarget.value)}
                >
                  <For each={workbook()!.sheets}>
                    {(s) => <option value={s.name}>{s.name}</option>}
                  </For>
                </select>
              </label>
            </div>
          </Show>

          <Show when={effective()}>
            {(table) => (
              <>
                <div class="import-preview">
                  <div class="import-subtitle">
                    Vista previa de{" "}
                    {source() === "clipboard" ? "lo pegado" : fileName()} (
                    {table().rows.length} fila(s))
                  </div>
                  <div class="import-preview-scroll">
                    <table>
                      <thead>
                        <tr>
                          <For each={table().headers}>{(h) => <th>{h}</th>}</For>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={table().rows.slice(0, PREVIEW_ROWS)}>
                          {(row) => (
                            <tr>
                              <For each={table().headers}>
                                {(_, i) => (
                                  <td>
                                    <Show when={row[i()] !== null} fallback={<em class="cell-null">NULL</em>}>
                                      {row[i()]}
                                    </Show>
                                  </td>
                                )}
                              </For>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div class="import-mapping">
                  <div class="import-subtitle">Mapeo de columnas</div>
                  <For each={targetCols()}>
                    {(col) => (
                      <div class="map-row">
                        <span class="map-target">{col}</span>
                        <span class="map-arrow">←</span>
                        <select
                          class="map-select"
                          value={mapping()[col] ?? OMIT}
                          onChange={(e) => setColumn(col, e.currentTarget.value)}
                        >
                          <option value={OMIT}>— (omitir)</option>
                          <For each={table().headers}>
                            {(h) => <option value={h}>{h}</option>}
                          </For>
                        </select>
                      </div>
                    )}
                  </For>
                </div>

                <div class="import-policy">
                  <span class="import-subtitle">Si una fila falla:</span>
                  <label>
                    <input
                      type="radio"
                      name="policy"
                      checked={policy() === "skip"}
                      onChange={() => setPolicy("skip")}
                    />{" "}
                    Omitir e insertar el resto
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="policy"
                      checked={policy() === "abort"}
                      onChange={() => setPolicy("abort")}
                    />{" "}
                    Abortar todo
                  </label>
                </div>
              </>
            )}
          </Show>

          <div class="modal-actions">
            <button onClick={props.onClose}>Cancelar</button>
            <button
              class="primary"
              disabled={running() || !effective() || !hasMapping(mapping())}
              onClick={runNow}
            >
              {running() ? "Importando…" : "Importar"}
            </button>
          </div>
        </Show>
    </Panel>
  );
}
