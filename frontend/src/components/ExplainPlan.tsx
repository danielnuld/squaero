import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  explainKind,
  buildStructuredExplain,
  parsePlan,
  expensivePath,
  layoutPlan,
  DEFAULT_LAYOUT,
  type PlanNode,
} from "../utils/explainPlan";
import { Panel } from "./Panel";

// Visual EXPLAIN plan (issue #187): renders the execution plan as an SVG node
// tree (self-contained, like the ER diagram #145 — no graph library), with each
// node's operation, table, estimated rows and cost, and the costliest path
// highlighted. Structured formats: PostgreSQL/MySQL FORMAT=JSON, SQLite EXPLAIN
// QUERY PLAN (parsing is pure in utils/explainPlan). When the JSON can't be
// parsed the raw plan text is shown; engines without any structured format get
// an honest message. Reloads via createEffect keyed on conn/engine/sql with a
// monotonic token guard, clearing stale state before each load (lesson from #180).
export function ExplainPlan(props: {
  connId: string;
  engine: string;
  sql: string;
  onClose: () => void;
}) {
  const kind = createMemo(() => explainKind(props.engine));
  const [plan, setPlan] = createSignal<PlanNode | null>(null);
  const [raw, setRaw] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let token = 0;

  const load = async () => {
    const k = kind();
    const stmt = k ? buildStructuredExplain(props.engine, props.sql) : null;
    const mine = ++token;
    setPlan(null);
    setRaw(null);
    setError(null);
    if (!k || !stmt) return; // unsupported engine → honest message (no query)
    setLoading(true);
    try {
      const res: ResultSet = await runQuery(props.connId, stmt);
      if (mine !== token) return;
      const parsed = parsePlan(k, res.columns.map((c) => c.name), res.rows);
      if (parsed) setPlan(parsed);
      else setRaw(rawText(res)); // structured ran but couldn't be parsed
    } catch (err) {
      if (mine !== token) return;
      setError(errorText(err));
    } finally {
      if (mine === token) setLoading(false);
    }
  };

  createEffect(() => {
    void props.connId;
    void props.engine;
    void props.sql;
    void load();
  });

  const layout = createMemo(() => {
    const root = plan();
    return root ? layoutPlan(root, DEFAULT_LAYOUT) : null;
  });
  const hot = createMemo(() => {
    const root = plan();
    return root ? expensivePath(root) : new Set<number>();
  });

  const { nodeW, nodeH } = DEFAULT_LAYOUT;

  return (
    <Panel title="Plan de ejecución" class="explain-plan" onClose={props.onClose}>
      <div class="sm-head">
        <h2>Plan de ejecución</h2>
        <div class="sm-actions">
          <Show when={kind()}>
            <button class="edit-btn" disabled={loading()} onClick={load}>
              {loading() ? "Analizando…" : "⟳ Actualizar"}
            </button>
          </Show>
          <button class="edit-btn" onClick={props.onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="grid-error" role="alert">{error()}</div>
      </Show>

      <Show
        when={kind()}
        fallback={
          <p class="grid-empty">
            El motor "{props.engine || "desconocido"}" no expone un plan estructurado.
          </p>
        }
      >
        {/* Parsed plan → SVG tree. */}
        <Show when={layout()}>
          {(lo) => (
            <div class="ep-scroll">
              <svg
                class="ep-svg"
                width={Math.max(lo().width, 1)}
                height={Math.max(lo().height, 1)}
                viewBox={`0 0 ${Math.max(lo().width, 1)} ${Math.max(lo().height, 1)}`}
              >
                <For each={lo().edges}>
                  {(e) => (
                    <line
                      class="ep-edge"
                      x1={e.from.x}
                      y1={e.from.y}
                      x2={e.to.x}
                      y2={e.to.y}
                    />
                  )}
                </For>
                <For each={lo().nodes}>
                  {(n) => (
                    <g class={`ep-node ${hot().has(n.id) ? "hot" : ""}`}>
                      <rect x={n.x} y={n.y} width={nodeW} height={nodeH} rx="6" />
                      <text class="ep-op" x={n.x + 8} y={n.y + 18}>
                        {n.op}
                      </text>
                      <Show when={n.table}>
                        <text class="ep-table" x={n.x + 8} y={n.y + 34}>
                          {n.table}
                        </text>
                      </Show>
                      <text class="ep-meta" x={n.x + 8} y={n.y + 50}>
                        {[
                          n.rows !== undefined ? `${n.rows} filas` : null,
                          n.cost !== undefined ? `coste ${n.cost}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </text>
                      <Show when={n.detail}>
                        <title>{n.detail}</title>
                      </Show>
                    </g>
                  )}
                </For>
              </svg>
            </div>
          )}
        </Show>

        {/* Structured EXPLAIN ran but couldn't be parsed → show the raw plan. */}
        <Show when={raw()}>
          <pre class="ep-raw">{raw()}</pre>
        </Show>

        <Show when={!plan() && !raw() && !error()}>
          <p class="grid-empty">{loading() ? "Analizando…" : "Sin plan."}</p>
        </Show>
      </Show>
    </Panel>
  );
}

// Flatten a structured-EXPLAIN result to text for the unparsed fallback: the
// single JSON cell, or all rows joined (SQLite QUERY PLAN).
function rawText(res: ResultSet): string {
  if (res.rows.length === 1 && res.rows[0].length === 1) return res.rows[0][0] ?? "";
  return res.rows.map((r) => r.join("  ")).join("\n");
}
