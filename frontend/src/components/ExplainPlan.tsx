import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  explainKind,
  buildStructuredExplain,
  analyzeBlocked,
  parsePlan,
  planRows,
  planText,
  planTotals,
  visibleRows,
  type PlanNode,
  type PlanRow,
} from "../utils/explainPlan";
import { Panel } from "./Panel";
import { SqlHighlight } from "./SqlHighlight";
import { Icon } from "./icons";
import { t, tn } from "../utils/i18n";

// Execution plan (issue #187, audit A-09). The structured EXPLAIN is read into a
// node tree (utils/explainPlan.ts) and shown three ways: Árbol, an accessible
// tree with each node's own share of the cost as a bar, the costliest node
// marked and a detail pane for the selected node; Tabla, the same nodes as a
// table; Texto, the plan as indented text, which is also what «Copiar plan»
// copies. «Con ANALYZE» measures the real rows and times where the engine can,
// and only for a statement that only reads, since it runs it. When the engine's
// output can't be parsed the raw plan is shown; engines without a structured
// format get an honest message. Reloads keyed on conn/engine/sql/analyze with a
// monotonic token guard, clearing stale state before each load (#180).
export function ExplainPlan(props: {
  connId: string;
  engine: string;
  sql: string;
  onClose?: () => void;
  /** Inside the result pane's «Plan» tab (#691): Escape is not the panel's,
      and the statement is already on screen in the editor above. */
  docked?: boolean;
  /** «Abrir en el editor» for the analysed statement. Absent → no button. */
  onOpenSql?: (sql: string) => void;
}) {
  const [view, setView] = createSignal<"tree" | "table" | "text">("tree");
  const [analyze, setAnalyze] = createSignal(false);
  const kind = createMemo(() => explainKind(props.engine));
  const blocked = createMemo(() => analyzeBlocked(props.engine, props.sql));
  const [plan, setPlan] = createSignal<PlanNode | null>(null);
  const [raw, setRaw] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  let token = 0;

  const load = async () => {
    const k = kind();
    const stmt = k ? buildStructuredExplain(props.engine, props.sql, analyze() && !blocked()) : null;
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
    void analyze();
    void load();
  });

  const rows = createMemo(() => {
    const root = plan();
    return root ? planRows(root) : [];
  });
  const totals = createMemo(() => {
    const root = plan();
    return root ? planTotals(root) : null;
  });
  const text = () => {
    const root = plan();
    return root ? planText(root) : (raw() ?? "");
  };
  const measured = () => rows().some((r) => r.node.actualRows !== undefined);

  // --- Tree state: what is folded, which node is selected ------------------
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<number>>(new Set());
  const [selId, setSelId] = createSignal<number | null>(null);
  const shown = createMemo(() => visibleRows(rows(), collapsed()));
  const selected = (): PlanRow | undefined => rows().find((r) => r.id === selId()) ?? rows()[0];
  let treeEl: HTMLDivElement | undefined;
  const focusItem = (id: number) => {
    setSelId(id);
    treeEl?.querySelector<HTMLElement>(`[data-node="${id}"]`)?.focus();
  };
  const toggle = (id: number, open?: boolean) =>
    setCollapsed((c) => {
      const next = new Set(c);
      const fold = open === undefined ? !next.has(id) : !open;
      if (fold) next.add(id);
      else next.delete(id);
      return next;
    });
  const treeKey = (e: KeyboardEvent) => {
    const list = shown();
    const cur = selected();
    if (!cur) return;
    const i = list.findIndex((r) => r.id === cur.id);
    let to: number | null = null;
    if (e.key === "ArrowDown") to = list[Math.min(list.length - 1, i + 1)]?.id ?? null;
    else if (e.key === "ArrowUp") to = list[Math.max(0, i - 1)]?.id ?? null;
    else if (e.key === "Home") to = list[0]?.id ?? null;
    else if (e.key === "End") to = list[list.length - 1]?.id ?? null;
    else if (e.key === "ArrowRight" && cur.hasChildren) {
      if (collapsed().has(cur.id)) toggle(cur.id, true);
      else to = list[i + 1]?.id ?? null;
    } else if (e.key === "ArrowLeft") {
      if (cur.hasChildren && !collapsed().has(cur.id)) toggle(cur.id, false);
      else to = cur.parent;
    } else if (e.key === "Enter" && cur.hasChildren) toggle(cur.id);
    else return;
    e.preventDefault();
    if (to !== null) focusItem(to);
  };

  const copyPlan = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the Texto view shows it to copy by hand */
    }
  };

  const fmt = (n: number | undefined) => (n === undefined ? "" : String(Math.round(n * 100) / 100));
  const ms = (n: number | undefined) => (n === undefined ? "" : t("plan.ms", { n: fmt(n) }));
  const pct = (r: PlanRow) => (r.share === undefined ? "" : `${Math.round(r.share * 100)} %`);
  const summary = () => {
    const tt = totals();
    if (!tt) return "";
    return [
      tt.cost !== undefined ? t("plan.totalCost", { n: fmt(tt.cost) }) : null,
      tt.time !== undefined ? ms(tt.time) : null,
      tn("plan.nNodes", tt.nodes),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const VIEWS = [
    { id: "tree", label: "plan.tree" },
    { id: "table", label: "plan.table" },
    { id: "text", label: "plan.text" },
  ] as const;
  const viewKey = (e: KeyboardEvent) => {
    const i = VIEWS.findIndex((v) => v.id === view());
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    setView(VIEWS[(i + d + VIEWS.length) % VIEWS.length].id);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  };

  return (
    <Panel
      title={t("tab.explainPlan")}
      class="explain-plan"
      onClose={props.onClose}
      docked={props.docked}
      actions={
        <Show when={!props.docked}>
          <Show when={props.onOpenSql}>
            <button class="edit-btn" onClick={() => props.onOpenSql!(props.sql)}>
              {t("plan.openInEditor")}
            </button>
          </Show>
          <button class="edit-btn" disabled={!plan() && !raw()} onClick={copyPlan}>
            <Icon name="copy" size={14} class="eb-ic" /> {copied() ? t("plan.copied") : t("plan.copy")}
          </button>
        </Show>
      }
      status={<Show when={!props.docked}>{summary()}</Show>}
      onRefresh={kind() ? load : undefined}
      refreshing={loading()}
    >
      <Show when={!props.docked}>
        <div class="ep-query">
          <span class="ep-query-label">{t("plan.analysed")}</span>
          <SqlHighlight class="ep-query-sql" sql={props.sql} engine={props.engine} label={t("plan.analysed")} />
        </div>
      </Show>

      <Show
        when={kind()}
        fallback={<p class="grid-empty">{t("plan.unsupported", { engine: props.engine || t("plan.unknownEngine") })}</p>}
      >
        <div class="ep-opts" role="toolbar" aria-label={t("plan.optionsAria")}>
          <span class="seg" role="radiogroup" aria-label={t("plan.viewAria")} onKeyDown={viewKey}>
            <For each={VIEWS}>
              {(v) => (
                <button
                  type="button"
                  role="radio"
                  class="seg-btn"
                  classList={{ on: view() === v.id }}
                  aria-checked={view() === v.id}
                  tabindex={view() === v.id ? 0 : -1}
                  onClick={() => setView(v.id)}
                >
                  {t(v.label)}
                </button>
              )}
            </For>
          </span>
          <label class="ep-analyze" title={blocked() ? t(blocked()!) : t("plan.analyzeTitle")}>
            <input
              type="checkbox"
              checked={analyze() && !blocked()}
              disabled={!!blocked() || loading()}
              onChange={(e) => setAnalyze(e.currentTarget.checked)}
            />
            {t("plan.analyze")} <span class="ep-dim">{t("plan.analyzeNote")}</span>
          </label>
          <span class="ep-legend" aria-label={t("plan.legend")}>
            <span><span class="ep-swatch ep-swatch-cost" aria-hidden="true" />{t("plan.selfCost")}</span>
            <span><span class="ep-swatch ep-swatch-hot" aria-hidden="true" />{t("plan.costliest")}</span>
            <Show when={measured()}>
              <span><span class="ep-swatch ep-swatch-real" aria-hidden="true" />{t("plan.actualRows")}</span>
            </Show>
          </span>
          <span class="panel-bar-spacer" />
          <Show when={props.docked}>
            <span class="ep-dim">{summary()}</span>
            <button class="edit-btn" disabled={!plan() && !raw()} onClick={copyPlan}>
              {copied() ? t("plan.copied") : t("plan.copy")}
            </button>
          </Show>
        </div>

        <Show when={error()}>
          <div class="grid-error" role="alert">{error()}</div>
        </Show>

        <Show when={view() === "tree" && plan()}>
          <div class="ep-body">
            <div class="ep-tree" role="tree" aria-label={t("plan.treeAria")} ref={treeEl} onKeyDown={treeKey}>
              <div class="ep-tree-head" aria-hidden="true">
                <span>{t("plan.op")}</span>
                <span>{measured() ? t("plan.rowsBoth") : t("plan.rows")}</span>
                <span>{t("plan.selfCost")}</span>
                <span>{t("plan.time")}</span>
              </div>
              <For each={shown()}>
                {(r) => (
                  <div
                    class="ep-item"
                    classList={{ sel: selected()?.id === r.id, hot: r.hot, costliest: r.costliest }}
                    role="treeitem"
                    data-node={r.id}
                    aria-level={r.depth + 1}
                    aria-expanded={r.hasChildren ? !collapsed().has(r.id) : undefined}
                    aria-selected={selected()?.id === r.id}
                    tabindex={selected()?.id === r.id ? 0 : -1}
                    onClick={() => setSelId(r.id)}
                  >
                    <span class="ep-cell-op" style={{ "padding-left": `${r.depth * 16}px` }}>
                      <Show when={r.hasChildren} fallback={<span class="ep-twisty" />}>
                        <button
                          class="ep-twisty"
                          tabindex="-1"
                          aria-hidden="true"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(r.id);
                          }}
                        >
                          <Icon name={collapsed().has(r.id) ? "chevron-right" : "chevron-down"} size={12} />
                        </button>
                      </Show>
                      <span class="ep-op">{r.op}</span>
                      <Show when={r.table}>
                        <span class="ep-obj">{r.table}</span>
                      </Show>
                      <Show when={r.detail}>
                        <span class="ep-dim">{r.detail}</span>
                      </Show>
                      <Show when={r.costliest}>
                        <span class="ep-badge">{t("plan.costliestBadge")}</span>
                      </Show>
                    </span>
                    <span class="num">
                      {r.rows ?? ""}
                      <Show when={r.node.actualRows !== undefined}>
                        <span class="ep-dim"> / </span>
                        <span class="ep-real">{r.node.actualRows}</span>
                      </Show>
                    </span>
                    <span class="ep-cost">
                      <span class="ep-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round((r.share ?? 0) * 100)}%` }} />
                      </span>
                      <span class="num">{pct(r)}</span>
                    </span>
                    <span class="num">{ms(r.node.actualTime)}</span>
                  </div>
                )}
              </For>
            </div>
            <Show when={selected()}>
              {(r) => (
                <aside class="ep-detail-pane" aria-label={t("plan.detailAria")}>
                  <div class="ep-detail-title">
                    {r().op}
                    {r().table ? ` · ${r().table}` : ""}
                  </div>
                  <Show when={r().share !== undefined}>
                    <div class="ep-dim">{t("plan.shareOfTotal", { n: Math.round(r().share! * 100) })}</div>
                  </Show>
                  <dl>
                    <Show when={r().table}>
                      <dt>{t("plan.relation")}</dt>
                      <dd>{r().table}</dd>
                    </Show>
                    <Show when={r().rows !== undefined}>
                      <dt>{t("plan.rowsEst")}</dt>
                      <dd>{r().rows}</dd>
                    </Show>
                    <Show when={r().node.actualRows !== undefined}>
                      <dt>{t("plan.actualRows")}</dt>
                      <dd>{r().node.actualRows}</dd>
                    </Show>
                    <Show when={r().node.loops !== undefined}>
                      <dt>{t("plan.loops")}</dt>
                      <dd>{r().node.loops}</dd>
                    </Show>
                    <Show when={r().node.width !== undefined}>
                      <dt>{t("plan.width")}</dt>
                      <dd>{t("plan.bytes", { n: r().node.width! })}</dd>
                    </Show>
                    <Show when={r().cost !== undefined}>
                      <dt>{t("plan.cost")}</dt>
                      <dd>
                        {r().node.startupCost !== undefined ? `${fmt(r().node.startupCost)} … ` : ""}
                        {fmt(r().cost)}
                      </dd>
                    </Show>
                    <Show when={r().node.actualTime !== undefined}>
                      <dt>{t("plan.actualTime")}</dt>
                      <dd>{ms(r().node.actualTime)}</dd>
                    </Show>
                    <For each={r().node.props ?? []}>
                      {([k, v]) => (
                        <>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </>
                      )}
                    </For>
                    <Show when={!r().node.props && r().detail}>
                      <dt>{t("plan.detail")}</dt>
                      <dd>{r().detail}</dd>
                    </Show>
                  </dl>
                  <div class="ep-dim">{measured() ? t("plan.measuredNote") : t("plan.estimatedNote")}</div>
                </aside>
              )}
            </Show>
          </div>
        </Show>

        <Show when={view() === "table" && plan()}>
          <div class="ep-scroll">
            <table class="ep-table">
              <thead>
                <tr>
                  <th scope="col">{t("plan.op")}</th>
                  <th scope="col">{t("plan.object")}</th>
                  <th scope="col" class="num">{t("plan.rows")}</th>
                  <Show when={measured()}>
                    <th scope="col" class="num">{t("plan.actualRows")}</th>
                  </Show>
                  <th scope="col" class="num">{t("plan.cost")}</th>
                  <th scope="col" class="num">{t("plan.selfCost")}</th>
                  <th scope="col">{t("plan.detail")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(r) => (
                    <tr classList={{ hot: r.hot }}>
                      <td style={{ "padding-left": `${8 + r.depth * 16}px` }}>{r.op}</td>
                      <td>{r.table ?? ""}</td>
                      <td class="num">{r.rows ?? ""}</td>
                      <Show when={measured()}>
                        <td class="num">{r.node.actualRows ?? ""}</td>
                      </Show>
                      <td class="num">{r.cost ?? ""}</td>
                      <td class="num">{pct(r)}</td>
                      <td class="ep-detail">{r.detail ?? ""}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={view() === "text" && plan()}>
          <pre class="ep-raw">{text()}</pre>
        </Show>

        {/* Structured EXPLAIN ran but couldn't be parsed → show the raw plan. */}
        <Show when={raw()}>
          <pre class="ep-raw">{raw()}</pre>
        </Show>

        <Show when={!plan() && !raw() && !error()}>
          <p class="grid-empty">{loading() ? t("plan.loading") : t("plan.none")}</p>
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
