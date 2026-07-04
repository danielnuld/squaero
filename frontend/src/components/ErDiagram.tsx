import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { Panel } from "./Panel";
import { schemaTree, schemaDescribe, parseTreeRows } from "../utils/schema";
import { errorText } from "../utils/errors";
import {
  inferRelations,
  tableHeight,
  gridPositions,
  type ErTable,
  type ErColumn,
} from "../utils/erDiagram";

// Entity-relationship diagram (issue #145, phase 1): lay every table out as a box
// with its columns and draw inferred foreign-key edges (schema.describe exposes
// no FKs, so relationships are inferred by naming — see utils/erDiagram.ts, and
// the edges are labelled "inferidas"). Boxes are draggable. Real FK extraction is
// a later phase needing driver support. Pure logic lives in utils/erDiagram.ts.
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

/** Walk the object tree (bounded) and describe each table into ErTable[]. */
async function loadTables(connId: string, max = MAX_TABLES): Promise<ErTable[]> {
  const targets: { table: string; db?: string; schema?: string }[] = [];
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

export function ErDiagram(props: { connId: string; onClose: () => void }) {
  const [tables, setTables] = createSignal<ErTable[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [pos, setPos] = createStore<Record<string, Pos>>({});

  const edges = createMemo(() => inferRelations(tables()));
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

  onMount(async () => {
    try {
      const ts = await loadTables(props.connId);
      const grid = gridPositions(ts.length, Math.max(1, Math.ceil(Math.sqrt(ts.length))), CELL_W, CELL_H);
      const p: Record<string, Pos> = {};
      ts.forEach((t, i) => (p[t.name] = grid[i]));
      setTables(ts);
      setPos(p);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  });

  // Drag a box by its header (tracks the pointer on the document until release).
  const startDrag = (name: string, e: MouseEvent) => {
    e.preventDefault();
    const start = pos[name] ?? { x: 0, y: 0 };
    const ox = e.clientX;
    const oy = e.clientY;
    const onMove = (ev: MouseEvent) =>
      setPos(name, { x: Math.max(0, start.x + (ev.clientX - ox)), y: Math.max(0, start.y + (ev.clientY - oy)) });
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
          <Show when={!loading()}>
            <span class="sm-count">
              {tables().length} tabla(s) · {edges().length} relación(es) inferida(s)
            </span>
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
            Relaciones inferidas por convención de nombres (p. ej. <code>cliente_id</code> →{" "}
            <code>clientes</code>). Arrastra las cajas para reorganizar.
          </p>
          <div class="er-canvas">
            <svg
              class="er-svg"
              width={extent().w}
              height={extent().h}
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
                    <g transform={`translate(${p().x}, ${p().y})`} class="er-box">
                      <rect class="er-box-bg" x="0" y="0" width={BOX_W} height={height(t)} rx="4" />
                      <rect
                        class="er-box-header"
                        x="0"
                        y="0"
                        width={BOX_W}
                        height={HEADER_H}
                        rx="4"
                        onMouseDown={(e) => startDrag(t.name, e)}
                      />
                      <text class="er-box-title" x="8" y={HEADER_H / 2 + 4} onMouseDown={(e) => startDrag(t.name, e)}>
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
