import { For, Show, createSignal, onCleanup } from "solid-js";
import type { ResultSet } from "../utils/query";
import { QueryError } from "../utils/query";
import { schemaDescribe } from "../utils/schema";
import { openConnection, closeConnection } from "../utils/conn";
import { rowInsert, txBegin, txCommit, txRollback } from "../utils/edit";
import {
  autoMap,
  hasMapping,
  runImport,
  type ColumnMapping,
  type ErrorPolicy,
  type ImportOps,
  type ImportSummary,
  type ParsedTable,
} from "../utils/importers";
import { buildDsn, type Connection } from "../utils/connections";

const OMIT = "";

/**
 * Data transfer wizard (#33): copy the current table's loaded rows into a table
 * on another connection (same or a different engine). The source rows are the
 * grid's result; the destination columns come from schema.describe on the opened
 * target connection; mapping + the transactional insert reuse the import path
 * (values cross as text and the target engine coerces them, which is how types
 * convert across engines). Client-side, opening a second connection for the
 * target (M9 decision). Bounded to the loaded rows.
 */
export function TransferWizard(props: {
  sourceResult: ResultSet;
  sourceTable: string;
  connections: Connection[];
  onClose: () => void;
}) {
  const [destDefId, setDestDefId] = createSignal(props.connections[0]?.id ?? "");
  const [destTable, setDestTable] = createSignal(props.sourceTable);
  const [destDb, setDestDb] = createSignal("");
  const [destCols, setDestCols] = createSignal<string[] | null>(null);
  const [mapping, setMapping] = createSignal<ColumnMapping>({});
  const [policy, setPolicy] = createSignal<ErrorPolicy>("skip");
  const [busy, setBusy] = createSignal(false);
  const [summary, setSummary] = createSignal<ImportSummary | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let destConnId: string | null = null;
  const closeDest = () => {
    if (destConnId) {
      void closeConnection(destConnId);
      destConnId = null;
    }
  };
  onCleanup(closeDest);

  const errMsg = (e: unknown) => (e instanceof QueryError ? e.message : String(e));
  const sourceHeaders = () => props.sourceResult.columns.map((c) => c.name);
  const sourceTableData = (): ParsedTable => ({
    headers: sourceHeaders(),
    rows: props.sourceResult.rows,
  });

  // Open the target and read the destination table's columns to map onto.
  const prepare = async () => {
    const def = props.connections.find((c) => c.id === destDefId());
    if (!def || !destTable().trim()) {
      setError("Elige una conexión destino y una tabla.");
      return;
    }
    setBusy(true);
    setError(null);
    setSummary(null);
    setDestCols(null);
    try {
      closeDest();
      destConnId = await openConnection(def.driver, buildDsn(def));
      const desc = await schemaDescribe(
        destConnId,
        destTable().trim(),
        destDb() || undefined,
      );
      const nameIdx = desc.columns.findIndex((c) => c.name === "name");
      const cols =
        nameIdx === -1
          ? []
          : desc.rows.map((r) => r[nameIdx]).filter((n): n is string => n !== null);
      if (cols.length === 0) {
        setError("La tabla destino no existe o no tiene columnas.");
        return;
      }
      setDestCols(cols);
      setMapping(autoMap(sourceHeaders(), cols));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const setColumn = (target: string, source: string) =>
    setMapping((m) => ({ ...m, [target]: source === OMIT ? null : source }));

  const transfer = async () => {
    if (!destConnId || !hasMapping(mapping())) return;
    const connId = destConnId;
    const target = {
      table: destTable().trim(),
      db: destDb() || undefined,
    };
    setBusy(true);
    setError(null);
    const ops: ImportOps = {
      begin: () => txBegin(connId),
      commit: () => txCommit(connId),
      rollback: () => txRollback(connId),
      insert: async (values) => {
        await rowInsert(connId, target, values, false);
      },
    };
    try {
      setSummary(await runImport(sourceTableData(), mapping(), policy(), ops));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Transferir datos · {props.sourceTable}</h2>
        <p class="import-subtitle">
          Origen: {props.sourceResult.rows.length} fila(s) cargada(s)
          {props.sourceResult.truncated ? " (truncado)" : ""}
        </p>

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
                <strong>{summary()!.inserted}</strong> fila(s) transferida(s)
                {summary()!.aborted
                  ? " — abortado, no se aplicó ningún cambio."
                  : summary()!.errors.length > 0
                    ? `, ${summary()!.errors.length} con error (omitidas).`
                    : "."}
              </p>
              <div class="modal-actions">
                <button class="primary" onClick={props.onClose}>
                  Cerrar
                </button>
              </div>
            </div>
          }
        >
          <div class="import-field">
            <label>
              Destino:{" "}
              <select
                value={destDefId()}
                onChange={(e) => setDestDefId(e.currentTarget.value)}
              >
                <For each={props.connections}>
                  {(c) => <option value={c.id}>{c.name}</option>}
                </For>
              </select>
            </label>{" "}
            <label>
              Base:{" "}
              <input
                type="text"
                value={destDb()}
                placeholder="(por defecto)"
                onInput={(e) => setDestDb(e.currentTarget.value)}
              />
            </label>{" "}
            <label>
              Tabla:{" "}
              <input
                type="text"
                value={destTable()}
                onInput={(e) => setDestTable(e.currentTarget.value)}
              />
            </label>{" "}
            <button class="edit-btn" disabled={busy()} onClick={prepare}>
              Preparar
            </button>
          </div>

          <Show when={destCols()}>
            <div class="import-mapping">
              <div class="import-subtitle">Mapeo de columnas (destino ← origen)</div>
              <For each={destCols()!}>
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
                      <For each={sourceHeaders()}>
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
                  name="tpolicy"
                  checked={policy() === "skip"}
                  onChange={() => setPolicy("skip")}
                />{" "}
                Omitir e insertar el resto
              </label>
              <label>
                <input
                  type="radio"
                  name="tpolicy"
                  checked={policy() === "abort"}
                  onChange={() => setPolicy("abort")}
                />{" "}
                Abortar todo
              </label>
            </div>
          </Show>

          <div class="modal-actions">
            <button onClick={props.onClose}>Cancelar</button>
            <button
              class="primary"
              disabled={busy() || !destCols() || !hasMapping(mapping())}
              onClick={transfer}
            >
              {busy() ? "Transfiriendo…" : "Transferir"}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
