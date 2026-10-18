import { For, Show, createEffect, createSignal } from "solid-js";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import { errorText } from "../utils/errors";
import { runQuery } from "../utils/query";
import { parseTreeRows, schemaDescribe, schemaTree } from "../utils/schema";
import { describeColumnTypes } from "../utils/edit";
import { cancelQuery } from "../utils/transport";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  matchLabel,
  runSearch,
  searchRefusal,
  type MatchMode,
  type SearchOptions,
  type TableResult,
} from "../utils/dataSearch";

/**
 * Search a text across the tables of the active database or one of its schemas
 * (issue #671). One bounded SELECT per table, run in order and cancellable; the
 * SQL is utils/dataSearch's. A table with matches opens them in a query tab.
 */
export function DataSearchPanel(props: {
  connId: string;
  engine: string;
  db: string | null;
  /** Open `sql` in a new query tab titled `table` and run it. */
  onOpen: (sql: string, table: string) => void;
}) {
  const [schemas, setSchemas] = createSignal<string[]>([]);
  const [schema, setSchema] = createSignal("");
  const [tables, setTables] = createSignal<string[]>([]);
  const [picked, setPicked] = createSignal<Record<string, boolean>>({});
  const [text, setText] = createSignal("");
  const [mode, setMode] = createSignal<MatchMode>("contains");
  const [ignoreCase, setIgnoreCase] = createSignal(true);
  const [numeric, setNumeric] = createSignal(false);
  const [limit, setLimit] = createSignal(DEFAULT_LIMIT);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{ text: string; error?: boolean } | null>(null);
  const [results, setResults] = createSignal<TableResult[]>([]);

  // Same level detection as the backup panel: the database lists its tables
  // directly (MySQL, SQLite, Informix) or its schemas (Postgres, SQL Server).
  let token = 0;
  createEffect(() => {
    const connId = props.connId;
    const db = props.db;
    const sch = schema();
    const my = ++token;
    setTables([]);
    if (!connId || !db) return;
    schemaTree(connId, db, sch || undefined)
      .then((res) => {
        if (my !== token) return;
        const rows = parseTreeRows(res, "schema");
        const leaves = rows.filter((r) => r.kind === "table").map((r) => r.name);
        if (leaves.length === 0 && !sch) {
          setSchemas(rows.map((r) => r.name));
          return;
        }
        setTables(leaves);
        setPicked(Object.fromEntries(leaves.map((n) => [n, true])));
      })
      .catch((err) => {
        if (my === token) setStatus({ text: errorText(err), error: true });
      });
  });

  const chosen = () => tables().filter((n) => picked()[n]);
  const pickAll = (on: boolean) => setPicked(Object.fromEntries(tables().map((n) => [n, on])));

  let stop = false;
  const start = async () => {
    const db = props.db ?? undefined;
    const sch = schema() || undefined;
    const opts: SearchOptions = { text: text(), mode: mode(), ignoreCase: ignoreCase(), numeric: numeric(), limit: limit() };
    const refused = searchRefusal(props.engine, opts);
    if (refused) {
      setStatus({ text: t(refused), error: true });
      return;
    }
    const connId = props.connId;
    const cap = clampLimit(opts.limit);
    stop = false;
    setBusy(true);
    setResults([]);
    try {
      const out = await runSearch(
        chosen().map((name) => ({ name, db, schema: sch })),
        props.engine,
        opts,
        {
          describe: async (tb) => describeColumnTypes(await schemaDescribe(connId, tb.name, tb.db, tb.schema)),
          // The cap travels to the core too, so its own default never cuts below it.
          count: async (sql) => (await runQuery(connId, sql, cap)).rows.length,
        },
        () => stop,
        (i, total, table) => setStatus({ text: t("ds.progress", { i, total, table }) }),
      );
      setResults(out.results);
      const hits = out.results.filter((r) => r.count > 0).length;
      setStatus({
        text: t(out.stopped ? "ds.stopped" : "ds.done", { hits, searched: out.results.length, total: chosen().length }),
      });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    stop = true;
    void cancelQuery(props.connId).catch(() => {});
  };

  // Matches first, then the tables that could not be searched; plain misses are counted, not listed.
  const shown = () => [
    ...results().filter((r) => r.count > 0),
    ...results().filter((r) => r.error || r.skipped),
  ];

  return (
    <Panel title={t("tool.search.tab")}>
      <Show when={status()}>
        <div class={status()!.error ? "grid-error" : "import-subtitle"} role={status()!.error ? "alert" : "status"}>
          {status()!.text}
        </div>
      </Show>
      <Show when={props.db} fallback={<p class="import-subtitle">{t("ds.noDb")}</p>}>
        <div class="import-field">
          <span>{t("bk.db", { db: props.db! })}</span>{" "}
          <Show when={schemas().length > 0}>
            <label>
              {t("bk.schema")}{" "}
              <select value={schema()} disabled={busy()} onChange={(e) => setSchema(e.currentTarget.value)}>
                <option value="" />
                <For each={schemas()}>{(s) => <option value={s}>{s}</option>}</For>
              </select>
            </label>
          </Show>
        </div>
        <div class="import-field">
          <label>
            {t("ds.text")}{" "}
            <input
              type="search"
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy() && chosen().length > 0 && void start()}
            />
          </label>{" "}
          <label>
            {t("ds.mode")}{" "}
            <select value={mode()} onChange={(e) => setMode(e.currentTarget.value as MatchMode)}>
              <option value="contains">{t("ds.mode.contains")}</option>
              <option value="startsWith">{t("ds.mode.startsWith")}</option>
              <option value="exact">{t("ds.mode.exact")}</option>
            </select>
          </label>{" "}
          <label title={t("ds.ignoreCaseHint")}>
            <input type="checkbox" checked={ignoreCase()} onChange={(e) => setIgnoreCase(e.currentTarget.checked)} />{" "}
            {t("ds.ignoreCase")}
          </label>{" "}
          <label>
            <input type="checkbox" checked={numeric()} onChange={(e) => setNumeric(e.currentTarget.checked)} />{" "}
            {t("ds.numeric")}
          </label>{" "}
          <label>
            {t("ds.limit")}{" "}
            <input
              type="number"
              min="1"
              max={MAX_LIMIT}
              value={limit()}
              style={{ width: "6em" }}
              onChange={(e) => setLimit(clampLimit(e.currentTarget.valueAsNumber))}
            />
          </label>
        </div>
        <Show when={tables().length > 0}>
          <div class="import-subtitle">
            {t("ds.tables", { n: chosen().length, total: tables().length })}{" "}
            <button class="edit-btn" disabled={busy()} onClick={() => pickAll(true)}>{t("bk.selectAll")}</button>{" "}
            <button class="edit-btn" disabled={busy()} onClick={() => pickAll(false)}>{t("bk.selectNone")}</button>
          </div>
          <div class="import-mapping">
            <For each={tables()}>
              {(n) => (
                <label class="map-row">
                  <input
                    type="checkbox"
                    disabled={busy()}
                    checked={!!picked()[n]}
                    onChange={(e) => setPicked((p) => ({ ...p, [n]: e.currentTarget.checked }))}
                  />{" "}
                  {n}
                </label>
              )}
            </For>
          </div>
        </Show>
        <div class="modal-actions">
          <Show
            when={busy()}
            fallback={
              <button class="primary" disabled={chosen().length === 0 || !props.connId} onClick={() => void start()}>
                {t("ds.start")}
              </button>
            }
          >
            <button onClick={cancel}>{t("common.cancel")}</button>
          </Show>
        </div>
        <Show when={shown().length > 0}>
          <div class="import-mapping" role="list" aria-label={t("ds.results")}>
            <For each={shown()}>
              {(r) => (
                <div class="map-row" role="listitem">
                  <strong>{r.table}</strong>{" "}
                  <Show when={r.count > 0}>
                    {t("ds.matches", { n: matchLabel(r) })}{" "}
                    <Show when={r.capped}>
                      <span class="import-subtitle">{t("ds.capped", { n: r.count })}</span>{" "}
                    </Show>
                    <button class="edit-btn" onClick={() => props.onOpen(r.openSql!, r.table)}>
                      {t("ds.open")}
                    </button>
                  </Show>
                  <Show when={r.skipped}>
                    <span class="import-subtitle">{t(r.skipped!)}</span>
                  </Show>
                  <Show when={r.error}>
                    <span class="grid-error">{r.error}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </Panel>
  );
}
