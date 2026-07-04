import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { schemaDescribe } from "../utils/schema";
import { rowInsert, txBegin, txCommit, txRollback } from "../utils/edit";
import { errorText } from "../utils/errors";
import {
  defaultGen,
  generateRows,
  makeRng,
  clampCount,
  GEN_KINDS,
  type ColumnGen,
  type GenKind,
} from "../utils/dataGen";
import { Modal } from "./Modal";

const PREVIEW_ROWS = 5;
const PREVIEW_SEED = 0x9e3779b9; // stable preview independent of the real run

/**
 * Test-data generator (issue #147): pick a per-column strategy and a row count,
 * preview a deterministic sample, and insert the generated rows into the target
 * table inside a transaction (client-side, reusing the row.insert + tx.* path).
 * The generation logic is the pure helpers in utils/dataGen.ts; this component is
 * the modal that fetches the columns, drives the strategies and applies them.
 */
export function DataGenerator(props: {
  connId: string;
  target: { table: string; db?: string; schema?: string };
  onClose: () => void;
  onGenerated?: () => void;
}) {
  const [gens, setGens] = createStore<ColumnGen[]>([]);
  const [count, setCount] = createSignal(10);
  const [loaded, setLoaded] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [summary, setSummary] = createSignal<number | null>(null);

  onMount(async () => {
    try {
      const desc = await schemaDescribe(
        props.connId,
        props.target.table,
        props.target.db,
        props.target.schema,
      );
      const idx = (n: string) => desc.columns.findIndex((c) => c.name === n);
      const ni = idx("name");
      const ti = idx("type");
      const pi = idx("pk");
      const cols = desc.rows
        .map((r) => ({
          name: ni >= 0 ? r[ni] : null,
          type: (ti >= 0 ? r[ti] : null) ?? "text",
          pk: pi >= 0 && (r[pi] ?? "0") !== "0",
        }))
        .filter((c): c is { name: string; type: string; pk: boolean } => !!c.name);
      setGens(cols.map((c) => defaultGen(c.name, c.type, c.pk)));
      setLoaded(true);
    } catch (err) {
      setError(errorText(err));
    }
  });

  const patch = (i: number, key: keyof ColumnGen, value: string | number) =>
    setGens(i, key as keyof ColumnGen, value as never);
  const patchNum = (i: number, key: keyof ColumnGen, value: string) =>
    patch(i, key, Number(value));

  // Deterministic preview (fixed seed) so the sample is stable as the form is
  // edited; the real run uses Math.random for varied data.
  const preview = createMemo(() =>
    generateRows([...gens], Math.min(clampCount(count()), PREVIEW_ROWS), makeRng(PREVIEW_SEED)),
  );
  const activeCols = createMemo(() => gens.filter((g) => g.kind !== "skip").map((g) => g.column));

  const generate = async () => {
    const n = clampCount(count());
    if (activeCols().length === 0) {
      setError("Todas las columnas están omitidas: no hay nada que insertar.");
      return;
    }
    const rows = generateRows([...gens], n, Math.random);
    setBusy(true);
    setError(null);
    try {
      await txBegin(props.connId);
      try {
        for (const values of rows) {
          await rowInsert(props.connId, props.target, values, false);
        }
        await txCommit(props.connId);
      } catch (err) {
        try {
          await txRollback(props.connId);
        } catch {
          /* best-effort rollback */
        }
        throw err;
      }
      setSummary(rows.length);
      props.onGenerated?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Generar datos" wide onClose={props.onClose}>
      <h2>Generar datos · {props.target.table}</h2>

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
              <strong>{summary()}</strong> fila(s) generada(s) e insertada(s).
            </p>
            <div class="modal-actions">
              <button class="primary" onClick={props.onClose}>
                Cerrar
              </button>
            </div>
          </div>
        }
      >
        <label class="field">
          <span>Número de filas</span>
          <input
            type="number"
            min="1"
            max="10000"
            value={count()}
            onInput={(e) => setCount(Number(e.currentTarget.value))}
          />
        </label>

        <Show when={loaded()} fallback={<p class="grid-empty">Cargando columnas…</p>}>
          <table class="td-table">
            <thead>
              <tr>
                <th>Columna</th>
                <th>Tipo</th>
                <th>Estrategia</th>
                <th>Parámetros</th>
              </tr>
            </thead>
            <tbody>
              <For each={gens}>
                {(g, i) => (
                  <tr>
                    <td>{g.column}</td>
                    <td class="col-type">{g.type}</td>
                    <td>
                      <select
                        class="map-select"
                        value={g.kind}
                        onChange={(e) => patch(i(), "kind", e.currentTarget.value as GenKind)}
                      >
                        <For each={GEN_KINDS}>
                          {(k) => <option value={k.kind}>{k.label}</option>}
                        </For>
                      </select>
                    </td>
                    <td>
                      <Show when={g.kind === "sequence"}>
                        <span class="dg-params">
                          <label>inicio <input class="td-in dg-num" type="number" value={g.seqStart} onInput={(e) => patchNum(i(), "seqStart", e.currentTarget.value)} /></label>
                          <label>paso <input class="td-in dg-num" type="number" value={g.seqStep} onInput={(e) => patchNum(i(), "seqStep", e.currentTarget.value)} /></label>
                        </span>
                      </Show>
                      <Show when={g.kind === "number"}>
                        <span class="dg-params">
                          <label>mín <input class="td-in dg-num" type="number" value={g.min} onInput={(e) => patchNum(i(), "min", e.currentTarget.value)} /></label>
                          <label>máx <input class="td-in dg-num" type="number" value={g.max} onInput={(e) => patchNum(i(), "max", e.currentTarget.value)} /></label>
                          <label>dec <input class="td-in dg-num" type="number" value={g.decimals} onInput={(e) => patchNum(i(), "decimals", e.currentTarget.value)} /></label>
                        </span>
                      </Show>
                      <Show when={g.kind === "date"}>
                        <span class="dg-params">
                          <label>desde <input class="td-in" type="date" value={g.from} onInput={(e) => patch(i(), "from", e.currentTarget.value)} /></label>
                          <label>hasta <input class="td-in" type="date" value={g.to} onInput={(e) => patch(i(), "to", e.currentTarget.value)} /></label>
                        </span>
                      </Show>
                      <Show when={g.kind === "list"}>
                        <input class="td-in dg-wide" placeholder="a, b, c" value={g.list} onInput={(e) => patch(i(), "list", e.currentTarget.value)} />
                      </Show>
                      <Show when={g.kind === "fixed"}>
                        <input class="td-in dg-wide" placeholder="valor" value={g.fixed} onInput={(e) => patch(i(), "fixed", e.currentTarget.value)} />
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>

          <div class="ddl-header" style={{ "margin-top": "1rem" }}>
            <span>Vista previa ({preview().length} de {clampCount(count())})</span>
          </div>
          <div class="import-preview-scroll">
            <table>
              <thead>
                <tr>
                  <For each={activeCols()}>{(c) => <th>{c}</th>}</For>
                </tr>
              </thead>
              <tbody>
                <For each={preview()}>
                  {(row) => (
                    <tr>
                      <For each={activeCols()}>
                        {(c) => <td>{row[c] ?? "∅"}</td>}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        <div class="modal-actions">
          <span class="status-spacer" />
          <button disabled={busy()} onClick={props.onClose}>
            Cancelar
          </button>
          <button
            class="primary"
            disabled={busy() || !loaded() || activeCols().length === 0}
            onClick={generate}
          >
            {busy() ? "Generando…" : `Generar ${clampCount(count())} fila(s)`}
          </button>
        </div>
      </Show>
    </Modal>
  );
}
