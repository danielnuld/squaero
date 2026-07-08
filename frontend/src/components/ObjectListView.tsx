import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import { objectListFor, formatBytes } from "../utils/objectList";
import { objectBadge } from "../utils/objectIcons";
import { Panel } from "./Panel";

// Object-list view (UI design proposal, phase 3): opening a database shows its
// objects as a metadata grid (name, type, and per-engine row count / size /
// comment) with a type-filter strip, the way a desktop database tool does.
// Double-clicking a row opens that object's data. All via query.run over the
// per-engine SQL from utils/objectList.ts — no core change.
export function ObjectListView(props: {
  connId: string;
  engine: string;
  db: string;
  onOpenData: (name: string, type: string) => void;
  onClose: () => void;
}) {
  const support = createMemo(() => objectListFor(props.engine, props.db));
  const [result, setResult] = createSignal<ResultSet | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal<"all" | "table" | "view">("all");

  // Reload whenever the connection/engine/db changes. Monotonic token guards
  // against a slow earlier query overwriting a newer one; clear before awaiting
  // so a stale result never bleeds across connections.
  let token = 0;
  createEffect(() => {
    const s = support();
    const connId = props.connId;
    void props.db;
    const my = ++token;
    setResult(null);
    setError(null);
    if (!s.supported || !s.sql) return;
    setLoading(true);
    runQuery(connId, s.sql)
      .then((r) => {
        if (my === token) setResult(r);
      })
      .catch((err) => {
        if (my === token) setError(errorText(err));
      })
      .finally(() => {
        if (my === token) setLoading(false);
      });
  });

  const colIndex = (key: string) =>
    (result()?.columns ?? []).findIndex((c) => c.name.toLowerCase() === key);

  // Row indices (into result.rows) matching the active type filter.
  const view = createMemo<number[]>(() => {
    const rows = result()?.rows ?? [];
    const ti = colIndex("tipo");
    const f = filter();
    const out: number[] = [];
    rows.forEach((row, i) => {
      if (f === "all" || ti < 0 || String(row[ti]) === f) out.push(i);
    });
    return out;
  });

  const counts = createMemo(() => {
    const rows = result()?.rows ?? [];
    const ti = colIndex("tipo");
    let tables = 0;
    let views = 0;
    for (const row of rows) {
      const t = ti >= 0 ? String(row[ti]) : "table";
      if (t === "view") views++;
      else tables++;
    }
    return { tables, views, all: rows.length };
  });

  const cell = (rowIdx: number, key: string) => {
    const ci = colIndex(key);
    const raw = ci >= 0 ? result()!.rows[rowIdx][ci] : null;
    if (key === "tamano") return formatBytes(raw as string | null);
    return raw === null ? "" : String(raw);
  };

  const open = (rowIdx: number) => {
    const ni = colIndex("nombre");
    const ti = colIndex("tipo");
    if (ni < 0) return;
    const name = String(result()!.rows[rowIdx][ni]).trim();
    const type = ti >= 0 ? String(result()!.rows[rowIdx][ti]) : "table";
    props.onOpenData(name, type);
  };

  return (
    <Panel title={`Objetos · ${props.db}`} onClose={props.onClose} class="objlist">
      <Show
        when={support().supported}
        fallback={<p class="objlist-empty">{support().reason}</p>}
      >
        <div class="objlist-bar">
          <div class="objlist-tabs" role="tablist" aria-label="Tipo de objeto">
            <button
              class={`otab ${filter() === "all" ? "on" : ""}`}
              role="tab"
              aria-selected={filter() === "all"}
              onClick={() => setFilter("all")}
            >
              Todos <span class="otab-ct">{counts().all}</span>
            </button>
            <button
              class={`otab ${filter() === "table" ? "on" : ""}`}
              role="tab"
              aria-selected={filter() === "table"}
              onClick={() => setFilter("table")}
            >
              <span class="otab-mk" style={{ background: "var(--obj-table)" }} />
              Tablas <span class="otab-ct">{counts().tables}</span>
            </button>
            <button
              class={`otab ${filter() === "view" ? "on" : ""}`}
              role="tab"
              aria-selected={filter() === "view"}
              onClick={() => setFilter("view")}
            >
              <span class="otab-mk" style={{ background: "var(--obj-view)" }} />
              Vistas <span class="otab-ct">{counts().views}</span>
            </button>
          </div>
        </div>

        <Show when={error()}>
          <p class="objlist-error">{error()}</p>
        </Show>
        <Show when={loading()}>
          <p class="objlist-empty">Cargando objetos…</p>
        </Show>

        <Show when={result() && !loading()}>
          <div class="objlist-scroll">
            <table class="objlist-grid">
              <thead>
                <tr>
                  <For each={support().columns}>
                    {(c) => (
                      <th class={c.numeric ? "num" : ""}>{c.label}</th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For
                  each={view()}
                  fallback={
                    <tr>
                      <td colspan={support().columns.length} class="objlist-empty">
                        Sin objetos.
                      </td>
                    </tr>
                  }
                >
                  {(rowIdx) => {
                    const ti = colIndex("tipo");
                    const type =
                      ti >= 0 ? String(result()!.rows[rowIdx][ti]) : "table";
                    const badge = objectBadge(type);
                    return (
                      <tr
                        class="objlist-row"
                        onDblClick={() => open(rowIdx)}
                        title="Doble clic para abrir los datos"
                      >
                        <For each={support().columns}>
                          {(c, i) => (
                            <td class={c.numeric ? "num" : ""}>
                              <Show when={i() === 0} fallback={cell(rowIdx, c.key)}>
                                <span class="objlist-name">
                                  <span class={`objtree-badge ${badge.className}`}>
                                    {badge.text}
                                  </span>
                                  {cell(rowIdx, c.key)}
                                </span>
                              </Show>
                            </td>
                          )}
                        </For>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
    </Panel>
  );
}
