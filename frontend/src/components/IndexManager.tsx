import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { txBegin, txCommit, txRollback } from "../utils/edit";
import { errorText } from "../utils/errors";
import { schemaDescribe } from "../utils/schema";
import {
  indexListFor,
  constraintListFor,
  buildCreateIndex,
  buildDropIndex,
  buildAddConstraint,
  buildDropConstraint,
  type ConstraintKind,
  type CatalogList,
} from "../utils/indexes";
import { Panel } from "./Panel";
import { ConfirmDialog } from "./ConfirmDialog";

// Index / constraint manager (issue #139): view a table's indexes and constraints
// (today only visible inside the CREATE TABLE DDL) and create/drop them by form.
// Listing runs over catalogs via query.run (utils/indexes.ts); the generated DDL
// is previewed and applied in a transaction. Honest per engine — SQLite lists
// indexes but cannot ALTER-manage constraints. No core/driver change.
export function IndexManager(props: {
  connId: string;
  engine: string;
  table: string;
  db?: string;
  schema?: string;
  onClose: () => void;
  /** Reload the object tree after a change. */
  onChanged?: () => void;
}) {
  const container = () => props.schema ?? props.db;

  const idxSupport = createMemo<CatalogList>(() =>
    indexListFor(props.engine, props.table, props.db, props.schema),
  );
  const conSupport = createMemo<CatalogList>(() =>
    constraintListFor(props.engine, props.table, props.db, props.schema),
  );

  const [indexRows, setIndexRows] = createSignal<ResultSet | null>(null);
  const [conRows, setConRows] = createSignal<ResultSet | null>(null);
  const [columns, setColumns] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [pending, setPending] = createSignal<{ sql: string; label: string } | null>(null);

  // Create-index form.
  const [idxName, setIdxName] = createSignal("");
  const [idxCols, setIdxCols] = createSignal("");
  const [idxUnique, setIdxUnique] = createSignal(false);

  // Add-constraint form.
  const [conKind, setConKind] = createSignal<ConstraintKind>("unique");
  const [conName, setConName] = createSignal("");
  const [conCols, setConCols] = createSignal("");
  const [conExpr, setConExpr] = createSignal("");
  const [conRefTable, setConRefTable] = createSignal("");
  const [conRefCols, setConRefCols] = createSignal("");

  const splitCols = (s: string) => s.split(",").map((c) => c.trim()).filter((c) => c.length > 0);

  const idxPreview = createMemo(() =>
    buildCreateIndex(props.engine, {
      name: idxName(),
      table: props.table,
      columns: splitCols(idxCols()),
      unique: idxUnique(),
      container: container(),
    }),
  );

  const conPreview = createMemo(() =>
    buildAddConstraint(props.engine, {
      kind: conKind(),
      name: conName(),
      table: props.table,
      columns: splitCols(conCols()),
      checkExpr: conExpr(),
      refTable: conRefTable(),
      refColumns: splitCols(conRefCols()),
      container: container(),
    }),
  );

  const colIdx = (rs: ResultSet | null, name: string | null) =>
    name && rs ? rs.columns.findIndex((c) => c.name === name) : -1;

  // `isStale` lets the caller abort applying a result once a newer target has
  // been requested. Manual Refrescar passes the default (never stale).
  const load = async (isStale: () => boolean = () => false) => {
    const connId = props.connId;
    setLoading(true);
    setError(null);
    try {
      const idx = idxSupport();
      const con = conSupport();
      const [idxRes, conRes, desc] = await Promise.all([
        idx.supported && idx.sql ? runQuery(connId, idx.sql) : Promise.resolve(null),
        con.supported && con.sql ? runQuery(connId, con.sql) : Promise.resolve(null),
        schemaDescribe(connId, props.table, props.db, props.schema).catch(() => null),
      ]);
      if (isStale()) return;
      setIndexRows(idxRes);
      setConRows(conRes);
      if (desc) {
        const ni = desc.columns.findIndex((c) => c.name === "name");
        setColumns(ni >= 0 ? desc.rows.map((r) => r[ni]).filter((v): v is string => !!v) : []);
      }
    } catch (e) {
      if (!isStale()) setError(errorText(e));
    } finally {
      if (!isStale()) setLoading(false);
    }
  };

  // Reset + (re)load whenever the target changes. App renders one IndexManager
  // shared by every "indexes" tab, so state must not bleed across tables — and a
  // slower earlier fetch must not overwrite a newer one (cleanup-scoped flag,
  // covering db/schema, per the TableDesigner #136 review).
  createEffect(() => {
    void props.connId;
    void props.engine;
    void props.table;
    void props.db;
    void props.schema;
    setIndexRows(null);
    setConRows(null);
    setColumns([]);
    setError(null);
    setPending(null);
    setIdxName("");
    setIdxCols("");
    setIdxUnique(false);
    setConName("");
    setConCols("");
    setConExpr("");
    setConRefTable("");
    setConRefCols("");
    let superseded = false;
    void load(() => superseded);
    return () => {
      superseded = true;
    };
  });

  // Run one statement in a transaction, then reload the lists.
  const applySql = async (sql: string) => {
    setBusy(true);
    setError(null);
    try {
      await txBegin(props.connId);
      try {
        await runQuery(props.connId, sql);
        await txCommit(props.connId);
      } catch (e) {
        try {
          await txRollback(props.connId);
        } catch {
          /* best-effort rollback */
        }
        throw e;
      }
      setPending(null);
      props.onChanged?.();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const createIndex = () => {
    const b = idxPreview();
    if (!b.ok) {
      setError(b.error);
      return;
    }
    void applySql(b.sql).then(() => {
      setIdxName("");
      setIdxCols("");
      setIdxUnique(false);
    });
  };

  const addConstraint = () => {
    const b = conPreview();
    if (!b.ok) {
      setError(b.error);
      return;
    }
    void applySql(b.sql).then(() => {
      setConName("");
      setConCols("");
      setConExpr("");
      setConRefTable("");
      setConRefCols("");
    });
  };

  const dropIndexRow = (name: string) => {
    const b = buildDropIndex(props.engine, { name, table: props.table, container: container() });
    if (!b.ok) {
      setError(b.error);
      return;
    }
    setError(null); // clear any prior error so it doesn't show stale in the dialog
    setPending({ sql: b.sql, label: `Eliminar índice ${name}` });
  };

  const dropConstraintRow = (name: string, type: string | null) => {
    const b = buildDropConstraint(props.engine, {
      name,
      table: props.table,
      type: type ?? undefined,
      container: container(),
    });
    if (!b.ok) {
      setError(b.error);
      return;
    }
    setError(null);
    setPending({ sql: b.sql, label: `Eliminar constraint ${name}` });
  };

  const idxNameIdx = createMemo(() => colIdx(indexRows(), idxSupport().nameCol));
  const conNameIdx = createMemo(() => colIdx(conRows(), conSupport().nameCol));
  const conTypeIdx = createMemo(() => colIdx(conRows(), conSupport().typeCol));

  const previewError = (b: { ok: boolean } & Partial<{ error: string }>) =>
    !b.ok ? b.error : null;

  return (
    <Panel title={`Índices y constraints · ${props.table}`} wide onClose={props.onClose}>
      <div class="sm-head">
        <h2>Índices y constraints · {props.table}</h2>
        <div class="sm-actions">
          <button class="edit-btn" disabled={loading()} onClick={() => void load()}>
            {loading() ? "Actualizando…" : "⟳ Refrescar"}
          </button>
          <button class="edit-btn" onClick={props.onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      {/* Drop confirmation via the shared themed dialog, showing the exact SQL. */}
      <Show when={pending()}>
        {(p) => (
          <ConfirmDialog
            title={p().label}
            message="Esta acción no se puede deshacer."
            sql={p().sql}
            confirmLabel="Eliminar"
            busy={busy()}
            error={error()}
            onConfirm={() => void applySql(p().sql)}
            onCancel={() => setPending(null)}
          />
        )}
      </Show>

      <datalist id="im-cols">
        <For each={columns()}>{(c) => <option value={c} />}</For>
      </datalist>

      {/* ── Índices ── */}
      <h3>Índices</h3>
      <Show
        when={idxSupport().supported}
        fallback={<p class="grid-empty">{idxSupport().reason}</p>}
      >
        <CatalogTable
          rows={indexRows()}
          support={idxSupport()}
          nameIdx={idxNameIdx()}
          loading={loading()}
          empty="No hay índices."
          onDrop={(name) => dropIndexRow(name)}
        />

        <div class="im-form">
          <strong>Nuevo índice</strong>
          <div class="im-fields">
            <input
              class="td-in"
              placeholder="nombre_del_indice"
              value={idxName()}
              onInput={(e) => setIdxName(e.currentTarget.value)}
            />
            <input
              class="td-in"
              list="im-cols"
              placeholder="columnas (col1, col2)"
              value={idxCols()}
              onInput={(e) => setIdxCols(e.currentTarget.value)}
            />
            <label class="im-check">
              <input type="checkbox" checked={idxUnique()} onChange={(e) => setIdxUnique(e.currentTarget.checked)} />
              Único
            </label>
            <button class="primary" disabled={busy() || !idxPreview().ok} onClick={createIndex}>
              Crear índice
            </button>
          </div>
          <pre class="ddl-text">{idxPreview().ok ? (idxPreview() as { sql: string }).sql : previewError(idxPreview())}</pre>
        </div>
      </Show>

      {/* ── Constraints ── */}
      <h3>Constraints</h3>
      <Show
        when={conSupport().supported}
        fallback={<p class="grid-empty">{conSupport().reason}</p>}
      >
        <CatalogTable
          rows={conRows()}
          support={conSupport()}
          nameIdx={conNameIdx()}
          loading={loading()}
          empty="No hay constraints."
          onDrop={(name, row) => dropConstraintRow(name, conTypeIdx() >= 0 ? row[conTypeIdx()] : null)}
        />

        <div class="im-form">
          <strong>Nueva constraint</strong>
          <div class="im-fields">
            <select value={conKind()} onChange={(e) => setConKind(e.currentTarget.value as ConstraintKind)}>
              <option value="unique">UNIQUE</option>
              <option value="check">CHECK</option>
              <option value="foreignKey">FOREIGN KEY</option>
            </select>
            <input
              class="td-in"
              placeholder="nombre_constraint"
              value={conName()}
              onInput={(e) => setConName(e.currentTarget.value)}
            />
            <Show when={conKind() !== "check"}>
              <input
                class="td-in"
                list="im-cols"
                placeholder="columnas (col1, col2)"
                value={conCols()}
                onInput={(e) => setConCols(e.currentTarget.value)}
              />
            </Show>
            <Show when={conKind() === "check"}>
              <input
                class="td-in"
                placeholder="expresión (p.ej. edad >= 0)"
                value={conExpr()}
                onInput={(e) => setConExpr(e.currentTarget.value)}
              />
            </Show>
            <Show when={conKind() === "foreignKey"}>
              <input
                class="td-in"
                placeholder="tabla referenciada"
                value={conRefTable()}
                onInput={(e) => setConRefTable(e.currentTarget.value)}
              />
              <input
                class="td-in"
                placeholder="columnas referenciadas"
                value={conRefCols()}
                onInput={(e) => setConRefCols(e.currentTarget.value)}
              />
            </Show>
            <button class="primary" disabled={busy() || !conPreview().ok} onClick={addConstraint}>
              Agregar constraint
            </button>
          </div>
          <pre class="ddl-text">{conPreview().ok ? (conPreview() as { sql: string }).sql : previewError(conPreview())}</pre>
        </div>
      </Show>
    </Panel>
  );
}

// A catalog listing rendered as a table, with a per-row drop action.
function CatalogTable(props: {
  rows: ResultSet | null;
  support: CatalogList;
  nameIdx: number;
  loading: boolean;
  empty: string;
  onDrop: (name: string, row: (string | null)[]) => void;
}) {
  const dataRows = () => props.rows?.rows ?? [];
  const detailIdx = (col: string) =>
    props.rows ? props.rows.columns.findIndex((c) => c.name === col) : -1;

  return (
    <Show
      when={dataRows().length > 0}
      fallback={<p class="grid-empty">{props.loading ? "Cargando…" : props.empty}</p>}
    >
      <table class="struct-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <For each={props.support.detailCols}>{(d) => <th>{d.label}</th>}</For>
            <th />
          </tr>
        </thead>
        <tbody>
          <For each={dataRows()}>
            {(row) => {
              const name = props.nameIdx >= 0 ? row[props.nameIdx] : null;
              return (
                <tr>
                  <td>{name ?? <span class="cell-null">NULL</span>}</td>
                  <For each={props.support.detailCols}>
                    {(d) => {
                      const i = detailIdx(d.col);
                      return <td>{i >= 0 ? row[i] : ""}</td>;
                    }}
                  </For>
                  <td class="td-c">
                    <Show when={name}>
                      <button class="grid-action danger" title="Eliminar" onClick={() => props.onDrop(name!, row)}>
                        🗑
                      </button>
                    </Show>
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </Show>
  );
}
