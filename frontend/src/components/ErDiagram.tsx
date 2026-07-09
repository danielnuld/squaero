import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { Panel } from "./Panel";
import { schemaTree, schemaDescribe, parseTreeRows } from "../utils/schema";
import { runQuery } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  inferRelations,
  realEdges,
  tableHeight,
  gridPositions,
  type ErTable,
  type ErColumn,
  type ErEdge,
} from "../utils/erDiagram";
import {
  foreignKeysFor,
  sqliteForeignKeySql,
  parseForeignKeys,
  type ForeignKey,
  type ForeignKeyQuery,
} from "../utils/foreignKeys";

// Entity-relationship diagram (issue #145): lay every table out as a box with its
// columns and draw foreign-key edges. Relationships come from the engine's REAL
// foreign keys when it exposes them (issue #260, via query.run over catalogs —
// see utils/foreignKeys.ts); when it doesn't (MongoDB, or the FK query fails) we
// fall back to naming-convention inference and label the edges "inferidas" so it
// stays honest. Boxes are draggable. Pure logic lives in utils/erDiagram.ts +
// utils/foreignKeys.ts.
const BOX_W = 200;
const HEADER_H = 26;
const ROW_H = 18;
const CELL_W = BOX_W + 70;
const CELL_H = 240;
const MAX_TABLES = 40;

interface Pos {
  x: number;
  y: number;
}

/** Walk the object tree (bounded) and describe each table into ErTable[]. When
    `db` is given the walk is scoped to that database (working-database context). */
async function loadTables(connId: string, db: string | undefined, max = MAX_TABLES): Promise<ErTable[]> {
  const targets: { table: string; db?: string; schema?: string }[] = [];
  if (db) {
    const level1 = parseTreeRows(await schemaTree(connId, db), "schema");
    for (const n1 of level1) {
      if (targets.length >= max) break;
      if (n1.kind === "table" || n1.kind === "view") {
        targets.push({ table: n1.name, db });
        continue;
      }
      const level2 = parseTreeRows(await schemaTree(connId, db, n1.name), "schema");
      for (const n2 of level2) {
        if (targets.length >= max) break;
        targets.push({ table: n2.name, db, schema: n1.name });
      }
    }
  } else {
    const level0 = parseTreeRows(await schemaTree(connId), "database");
    for (const n0 of level0) {
      if (targets.length >= max) break;
      if (n0.kind === "table" || n0.kind === "view") {
        targets.push({ table: n0.name });
        continue;
      }
      const level1 = parseTreeRows(await schemaTree(connId, n0.name), "schema");
      for (const n1 of level1) {
        if (targets.length >= max) break;
        if (n1.kind === "table" || n1.kind === "view") {
          targets.push({ table: n1.name, db: n0.name });
          continue;
        }
        const level2 = parseTreeRows(await schemaTree(connId, n0.name, n1.name), "schema");
        for (const n2 of level2) {
          if (targets.length >= max) break;
          targets.push({ table: n2.name, db: n0.name, schema: n1.name });
        }
      }
    }
  }

  const tables: ErTable[] = [];
  for (const t of targets) {
    try {
      const desc = await schemaDescribe(connId, t.table, t.db, t.schema);
      const ni = desc.columns.findIndex((c) => c.name === "name");
      const ti = desc.columns.findIndex((c) => c.name === "type");
      const pi = desc.columns.findIndex((c) => c.name === "pk");
      const columns: ErColumn[] = desc.rows
        .map((r) => ({
          name: ni >= 0 ? (r[ni] ?? "") : "",
          type: ti >= 0 ? (r[ti] ?? "") : "",
          pk: pi >= 0 && (r[pi] ?? "0") !== "0",
        }))
        .filter((c) => c.name);
      tables.push({ name: t.table, columns });
    } catch {
      /* skip a table that fails to describe */
    }
  }
  return tables;
}

/** Fetch and parse the engine's real foreign keys for a supported plan. SQLite
    needs one PRAGMA per table; the others answer in a single catalog query.
    `truncated` is true if any FK query hit the core's row cap, so the caller can
    warn that the graph may be incomplete (docs/IPC.md: query.run caps silently
    when no limit is given). */
async function fetchForeignKeys(
  connId: string,
  engine: string,
  plan: ForeignKeyQuery,
  tables: ErTable[],
): Promise<{ fks: ForeignKey[]; truncated: boolean }> {
  if (plan.perTable) {
    const fks: ForeignKey[] = [];
    let truncated = false;
    for (const t of tables) {
      const r = await runQuery(connId, sqliteForeignKeySql(t.name));
      truncated = truncated || r.truncated;
      fks.push(...parseForeignKeys(engine, r.columns, r.rows, t.name));
    }
    return { fks, truncated };
  }
  const r = await runQuery(connId, plan.bulkSql!);
  return { fks: parseForeignKeys(engine, r.columns, r.rows), truncated: r.truncated };
}

export function ErDiagram(props: {
  connId: string;
  engine: string;
  db?: string;
  onClose: () => void;
}) {
  const [tables, setTables] = createSignal<ErTable[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [pos, setPos] = createStore<Record<string, Pos>>({});
  const [zoom, setZoom] = createSignal(1);
  const zoomBy = (f: number) => setZoom((z) => Math.min(2, Math.max(0.4, Math.round(z * f * 20) / 20)));

  // Edges are set once per (re)load alongside the tables; `realFks` records
  // whether they came from real FK metadata (vs naming inference) for the label,
  // `fkTruncated` whether the FK query hit the row cap (graph may be incomplete),
  // and `fkReason` the engine's honest explanation when it exposes no FKs.
  const [edges, setEdges] = createSignal<ErEdge[]>([]);
  const [realFks, setRealFks] = createSignal(false);
  const [fkTruncated, setFkTruncated] = createSignal(false);
  const [fkReason, setFkReason] = createSignal<string | null>(null);
  const height = (t: ErTable) => tableHeight(t.columns.length, HEADER_H, ROW_H);
  const center = (name: string, t: ErTable) => {
    const p = pos[name] ?? { x: 0, y: 0 };
    return { x: p.x + BOX_W / 2, y: p.y + height(t) / 2 };
  };
  const tableByName = (name: string) => tables().find((t) => t.name === name);

  // Canvas extent so the scroll area fits every box.
  const extent = createMemo(() => {
    let w = 400;
    let h = 300;
    for (const t of tables()) {
      const p = pos[t.name];
      if (!p) continue;
      w = Math.max(w, p.x + BOX_W + 24);
      h = Math.max(h, p.y + height(t) + 24);
    }
    return { w, h };
  });

  // (Re)load whenever the connection, engine or working database changes.
  createEffect(() => {
    const connId = props.connId;
    const engine = props.engine;
    const db = props.db;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const ts = await loadTables(connId, db);
        if (props.connId !== connId || props.db !== db) return; // superseded
        const grid = gridPositions(ts.length, Math.max(1, Math.ceil(Math.sqrt(ts.length))), CELL_W, CELL_H);
        const p: Record<string, Pos> = {};
        ts.forEach((t, i) => (p[t.name] = grid[i]));
        setPos(p);
        setTables(ts);

        // Prefer the engine's real foreign keys; fall back to naming inference
        // when the engine exposes none (with its honest reason) or if the FK
        // query fails (permissions/odd catalog).
        const names = ts.map((t) => t.name);
        const plan = foreignKeysFor(engine, db);
        let built: ErEdge[];
        let real = false;
        let truncated = false;
        let reason: string | null = null;
        if (plan.supported && (plan.perTable || plan.bulkSql)) {
          try {
            const res = await fetchForeignKeys(connId, engine, plan, ts);
            if (props.connId !== connId || props.db !== db) return; // superseded
            built = realEdges(res.fks, names);
            real = true;
            truncated = res.truncated;
          } catch {
            built = inferRelations(ts); // FK query failed → honest name inference
          }
        } else {
          built = inferRelations(ts);
          reason = plan.reason; // engine has no FKs (e.g. MongoDB)
        }
        setRealFks(real);
        setFkTruncated(truncated);
        setFkReason(reason);
        setEdges(built);
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    })();
  });

  // Re-run the grid layout (reset positions).
  const relayout = () => {
    const ts = tables();
    const grid = gridPositions(ts.length, Math.max(1, Math.ceil(Math.sqrt(ts.length))), CELL_W, CELL_H);
    const p: Record<string, Pos> = {};
    ts.forEach((t, i) => (p[t.name] = grid[i]));
    setPos(p);
  };

  // Drag a box (anywhere on it) — screen deltas are divided by the zoom so the box
  // tracks the cursor 1:1 at any scale, and the dragged table is moved to the end
  // of the list so it renders on top of the others.
  const startDrag = (name: string, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTables((ts) => [...ts.filter((t) => t.name !== name), ...ts.filter((t) => t.name === name)]);
    const start = pos[name] ?? { x: 0, y: 0 };
    const ox = e.clientX;
    const oy = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const s = zoom();
      setPos(name, {
        x: Math.max(0, start.x + (ev.clientX - ox) / s),
        y: Math.max(0, start.y + (ev.clientY - oy) / s),
      });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <Panel title="Diagrama ER" class="er-diagram" onClose={props.onClose}>
      <div class="sm-head">
        <h2>Diagrama entidad-relación</h2>
        <div class="sm-actions">
          <Show when={!loading() && tables().length > 0}>
            <span class="sm-count">
              {tables().length} tabla(s) · {edges().length} relación(es){" "}
              {realFks() ? "(FK reales)" : "(inferidas)"}
              {fkTruncated() ? " · lista incompleta" : ""}
            </span>
            <button class="edit-btn" title="Alejar" onClick={() => zoomBy(1 / 1.2)}>−</button>
            <span class="sm-count">{Math.round(zoom() * 100)}%</span>
            <button class="edit-btn" title="Acercar" onClick={() => zoomBy(1.2)}>+</button>
            <button class="edit-btn" title="Reordenar en cuadrícula" onClick={relayout}>Reordenar</button>
          </Show>
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

      <Show when={!loading()} fallback={<p class="grid-empty">Cargando esquema…</p>}>
        <Show
          when={tables().length > 0}
          fallback={<p class="grid-empty">No hay tablas para diagramar.</p>}
        >
          <p class="chart-hint">
            <Show
              when={realFks()}
              fallback={
                <>
                  Relaciones <strong>inferidas</strong> por convención de nombres (p. ej.{" "}
                  <code>cliente_id</code> → <code>clientes</code>):{" "}
                  {fkReason() ?? "este motor no expone llaves foráneas."}{" "}
                </>
              }
            >
              Relaciones a partir de las <strong>llaves foráneas reales</strong> del motor.{" "}
              <Show when={fkTruncated()}>
                <strong>Lista incompleta</strong>: se alcanzó el límite de filas, pueden faltar
                aristas.{" "}
              </Show>
            </Show>
            Arrastra las cajas para reorganizar; usa −/+ para el zoom.
          </p>
          <div class="er-canvas">
            <svg
              class="er-svg"
              width={extent().w * zoom()}
              height={extent().h * zoom()}
              viewBox={`0 0 ${extent().w} ${extent().h}`}
            >
              <defs>
                <marker id="er-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" class="er-arrow-head" />
                </marker>
              </defs>

              {/* Edges first so boxes sit on top of the line ends. */}
              <For each={edges()}>
                {(edge) => {
                  const from = () => tableByName(edge.fromTable);
                  const to = () => tableByName(edge.toTable);
                  return (
                    <Show when={from() && to()}>
                      {(() => {
                        const a = center(edge.fromTable, from()!);
                        const b = center(edge.toTable, to()!);
                        return (
                          <line
                            class="er-edge"
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            marker-end="url(#er-arrow)"
                          >
                            <title>
                              {edge.fromTable}.{edge.fromColumn} → {edge.toTable}
                              {edge.toColumn ? `.${edge.toColumn}` : ""}
                            </title>
                          </line>
                        );
                      })()}
                    </Show>
                  );
                }}
              </For>

              <For each={tables()}>
                {(t) => {
                  const p = () => pos[t.name] ?? { x: 0, y: 0 };
                  return (
                    <g
                      transform={`translate(${p().x}, ${p().y})`}
                      class="er-box"
                      onMouseDown={(e) => startDrag(t.name, e)}
                    >
                      <rect class="er-box-bg" x="0" y="0" width={BOX_W} height={height(t)} rx="4" />
                      <rect class="er-box-header" x="0" y="0" width={BOX_W} height={HEADER_H} rx="4" />
                      <text class="er-box-title" x="8" y={HEADER_H / 2 + 4}>
                        {t.name}
                      </text>
                      <For each={t.columns}>
                        {(col, i) => (
                          <text
                            class={`er-col ${col.pk ? "er-col-pk" : ""}`}
                            x="8"
                            y={HEADER_H + i() * ROW_H + ROW_H / 2 + 4}
                          >
                            {col.pk ? "★ " : ""}
                            {col.name}
                            <tspan class="er-col-type"> {col.type}</tspan>
                          </text>
                        )}
                      </For>
                    </g>
                  );
                }}
              </For>
            </svg>
          </div>
        </Show>
      </Show>
    </Panel>
  );
}
