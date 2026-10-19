import { Dropdown } from "./Dropdown";
import { For, Show, createEffect, createMemo, createSignal, on, untrack } from "solid-js";
import { Panel } from "./Panel";
import { ResultGrid } from "./ResultGrid";
import { EmptyNote } from "./EmptyNote";
import { t } from "../utils/i18n";
import { errorText } from "../utils/errors";
import { runQuery } from "../utils/query";
import { parseTreeRows, schemaDescribe, schemaTree } from "../utils/schema";
import { describeColumnTypes } from "../utils/edit";
import { cancelQuery } from "../utils/transport";
import { countText } from "../utils/confirmText";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  matchLabel,
  runSearch,
  searchRefusal,
  searchableCounts,
  type MatchMode,
  type SearchOptions,
  type TableResult,
} from "../utils/dataSearch";

/** One search, as the form hands it to whoever runs it. */
export interface SearchRequest {
  db: string;
  schema?: string;
  tables: string[];
  opts: SearchOptions;
  /** Changes on every «Buscar», so the same request runs again. */
  nonce: number;
}

/**
 * Search a text across the tables of a database or one of its schemas
 * (issue #671). One bounded SELECT per table, run in order and cancellable; the
 * SQL is utils/dataSearch's.
 *
 * P6 (prototype DataSearch*): «Dónde» picks the database (and schema); each
 * table says how many columns the search can look at, and a table with none
 * cannot be ticked; accents can be ignored; while it runs a determinate bar
 * says which table of how many and the matches so far, with Cancelar; the
 * results list every searched table with its count and show the matching
 * rows of the chosen one, with «Abrir X filtrada». Docked in the side column
 * (`onSearch`), the form only builds the request: the results open as a
 * document tab, which is this same panel given the `request`.
 */
export function DataSearchPanel(props: {
  connId: string;
  engine: string;
  db: string | null;
  /** Open `sql` in a new query tab titled `table` and run it. */
  onOpen: (sql: string, table: string) => void;
  /** Docked: hand the search over instead of running it here. */
  onSearch?: (req: SearchRequest) => void;
  /** A search to run as soon as it arrives (the results tab). */
  request?: SearchRequest;
}) {
  const [databases, setDatabases] = createSignal<string[]>([]);
  const [db, setDb] = createSignal(props.db ?? "");
  const [schemas, setSchemas] = createSignal<string[]>([]);
  const [schema, setSchema] = createSignal("");
  const [tables, setTables] = createSignal<string[]>([]);
  const [picked, setPicked] = createSignal<Record<string, boolean>>({});
  /** Declared type per column, per table: read once, in the background. */
  const [described, setDescribed] = createSignal<Record<string, Record<string, string>>>({});
  const [text, setText] = createSignal("");
  const [mode, setMode] = createSignal<MatchMode>("contains");
  const [ignoreCase, setIgnoreCase] = createSignal(true);
  const [ignoreAccents, setIgnoreAccents] = createSignal(false);
  const [numeric, setNumeric] = createSignal(false);
  const [limit, setLimit] = createSignal(DEFAULT_LIMIT);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<{ i: number; total: number; table: string } | null>(null);
  const [results, setResults] = createSignal<TableResult[]>([]);
  const [last, setLast] = createSignal<{ req: SearchRequest; stopped: boolean } | null>(null);
  const [openTable, setOpenTable] = createSignal<string | null>(null);

  createEffect(() => setDb(props.db ?? ""));

  // The databases «Dónde» offers.
  createEffect(() => {
    const connId = props.connId;
    if (!connId) return;
    schemaTree(connId)
      .then((res) => setDatabases(parseTreeRows(res, "database").map((r) => r.name)))
      .catch(() => setDatabases([]));
  });

  // Same level detection as the backup panel: the database lists its tables
  // directly (MySQL, SQLite, Informix) or its schemas (Postgres, SQL Server).
  let token = 0;
  createEffect(
    on([() => props.connId, db, schema], ([connId, d, sch]) => {
      const my = ++token;
      setTables([]);
      setDescribed({});
      if (!connId || !d) return;
      schemaTree(connId, d, sch || undefined)
        .then(async (res) => {
          if (my !== token) return;
          const rows = parseTreeRows(res, "schema");
          const leaves = rows.filter((r) => r.kind === "table").map((r) => r.name);
          if (leaves.length === 0 && !sch) {
            setSchemas(rows.map((r) => r.name));
            return;
          }
          setTables(leaves);
          setPicked(Object.fromEntries(leaves.map((n) => [n, true])));
          // Column counts, table by table; a newer listing stops this one.
          for (const name of leaves) {
            if (my !== token) return;
            try {
              const cols = describeColumnTypes(await schemaDescribe(connId, name, d, sch || undefined));
              if (my === token) setDescribed((m) => ({ ...m, [name]: cols }));
            } catch {
              /* unreadable: the search will say so for this table */
            }
          }
        })
        .catch((err) => {
          if (my === token) setError(errorText(err));
        });
    }),
  );

  /** Whether the search could look at anything in a table, null while unknown. */
  const usable = (name: string): boolean | null => {
    const cols = described()[name];
    if (!cols) return null;
    const c = searchableCounts(cols, props.engine);
    return c.text > 0 || (numeric() && c.number > 0);
  };
  const colsNote = (name: string) => {
    const cols = described()[name];
    if (!cols) return "";
    const c = searchableCounts(cols, props.engine);
    if (c.text > 0) return countText("ds.cols.text", c.text);
    return c.number > 0 && !numeric() ? t("ds.cols.numberOnly") : t("ds.cols.none");
  };
  const chosen = () => tables().filter((n) => picked()[n] && usable(n) !== false);
  const pickAll = (on: boolean) => setPicked(Object.fromEntries(tables().map((n) => [n, on])));

  const buildRequest = (): SearchRequest => ({
    db: db(),
    schema: schema() || undefined,
    tables: chosen(),
    opts: {
      text: text(),
      mode: mode(),
      ignoreCase: ignoreCase(),
      ignoreAccents: ignoreAccents(),
      numeric: numeric(),
      limit: limit(),
    },
    nonce: Date.now(),
  });

  let stop = false;
  const start = async (req: SearchRequest) => {
    const refused = searchRefusal(props.engine, req.opts);
    if (refused) {
      setError(t(refused));
      return;
    }
    const connId = props.connId;
    const cap = clampLimit(req.opts.limit);
    stop = false;
    setError(null);
    setBusy(true);
    setResults([]);
    setOpenTable(null);
    setLast(null);
    try {
      const cache = untrack(described);
      const out = await runSearch(
        req.tables.map((name) => ({ name, db: req.db || undefined, schema: req.schema })),
        props.engine,
        req.opts,
        {
          describe: async (tb) =>
            cache[tb.name] ?? describeColumnTypes(await schemaDescribe(connId, tb.name, tb.db, tb.schema)),
          // The cap travels to the core too, so its own default never cuts below it.
          run: async (sql) => runQuery(connId, sql, cap),
        },
        () => stop,
        (i, total, table) => setProgress({ i, total, table }),
        (r) => {
          setResults((list) => [...list, r]);
          if (r.count > 0 && openTable() === null) setOpenTable(r.table);
        },
      );
      setLast({ req, stopped: out.stopped });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // The results tab: a request arrives from the side column and runs here,
  // with the form showing what was asked.
  createEffect(
    on(
      () => props.request,
      (req) => {
        if (!req) return;
        setDb(req.db);
        setSchema(req.schema ?? "");
        setText(req.opts.text);
        setMode(req.opts.mode);
        setIgnoreCase(req.opts.ignoreCase);
        setIgnoreAccents(!!req.opts.ignoreAccents);
        setNumeric(req.opts.numeric);
        setLimit(req.opts.limit);
        void start(req);
      },
    ),
  );

  const search = () => {
    const req = buildRequest();
    if (props.onSearch) {
      const refused = searchRefusal(props.engine, req.opts);
      if (refused) setError(t(refused));
      else {
        setError(null);
        props.onSearch(req);
      }
    } else void start(req);
  };

  const cancel = () => {
    stop = true;
    void cancelQuery(props.connId).catch(() => {});
  };

  const hits = createMemo(() => results().filter((r) => r.count > 0));
  const rowsFound = createMemo(() => hits().reduce((n, r) => n + r.count, 0));
  const opened = createMemo(() => results().find((r) => r.table === openTable()) ?? null);
  const skippedNote = createMemo(() => {
    const skipped = results().filter((r) => r.skipped);
    return skipped.length ? t("ds.skippedNote", { tables: skipped.map((r) => r.table).join(", ") }) : null;
  });

  const form = (
    <form
      class="ds-form"
      role="search"
      aria-label={t("ds.formAria")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy() && chosen().length > 0) search();
      }}
    >
      <label class="field">
        <span>{t("ds.where")}</span>
        <Dropdown
          value={db()}
          disabled={busy()}
          options={[
            ...(db() && !databases().includes(db()) ? [{ value: db(), label: db() }] : []),
            ...databases().map((d) => ({ value: d, label: d })),
          ]}
          onChange={(v) => {
            setSchema("");
            setSchemas([]);
            setDb(v);
          }}
        />
      </label>
      <Show when={schemas().length > 0}>
        <label class="field">
          <span>{t("bk.schema")}</span>
          <Dropdown
            value={schema()}
            disabled={busy()}
            options={[{ value: "", label: "" }, ...schemas().map((s) => ({ value: s, label: s }))]}
            onChange={setSchema}
          />
        </label>
      </Show>
      <label class="field">
        <span>{t("ds.text")}</span>
        <input
          type="search"
          value={text()}
          disabled={busy()}
          placeholder={t("ds.textPlaceholder")}
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </label>
      <div class="ds-row">
        <label class="field">
          <span>{t("ds.mode")}</span>
          <Dropdown
            value={mode()}
            disabled={busy()}
            options={[
              { value: "contains", label: t("ds.mode.contains") },
              { value: "startsWith", label: t("ds.mode.startsWith") },
              { value: "exact", label: t("ds.mode.exact") },
            ]}
            onChange={(v) => setMode(v as MatchMode)}
          />
        </label>
        <label class="field">
          <span>{t("ds.limit")}</span>
          <input
            type="number"
            min="1"
            max={MAX_LIMIT}
            value={limit()}
            disabled={busy()}
            class="ds-limit"
            onChange={(e) => setLimit(clampLimit(e.currentTarget.valueAsNumber))}
          />
        </label>
      </div>
      <label title={t("ds.ignoreCaseHint")}>
        <input type="checkbox" disabled={busy()} checked={ignoreCase()} onChange={(e) => setIgnoreCase(e.currentTarget.checked)} />{" "}
        {t("ds.ignoreCase")}
      </label>
      <label title={t("ds.ignoreAccentsHint")}>
        <input
          type="checkbox"
          disabled={busy()}
          checked={ignoreAccents()}
          onChange={(e) => setIgnoreAccents(e.currentTarget.checked)}
        />{" "}
        {t("ds.ignoreAccents")}
      </label>
      <label>
        <input type="checkbox" disabled={busy()} checked={numeric()} onChange={(e) => setNumeric(e.currentTarget.checked)} />{" "}
        {t("ds.numeric")}
      </label>
      <Show when={tables().length > 0}>
        <div class="ds-tables-head">
          <span>{t("ds.tablesHead", { n: chosen().length, total: tables().length })}</span>
          <span class="panel-bar-spacer" />
          <button type="button" class="edit-btn" disabled={busy()} onClick={() => pickAll(true)}>{t("bk.selectAll")}</button>
          <button type="button" class="edit-btn" disabled={busy()} onClick={() => pickAll(false)}>{t("bk.selectNone")}</button>
        </div>
        <div class="ds-tables">
          <For each={tables()}>
            {(n) => (
              <label class="ds-table" title={usable(n) === false ? colsNote(n) : undefined}>
                <input
                  type="checkbox"
                  disabled={busy() || usable(n) === false}
                  checked={!!picked()[n] && usable(n) !== false}
                  onChange={(e) => setPicked((p) => ({ ...p, [n]: e.currentTarget.checked }))}
                />
                <span class="ds-table-name">{n}</span>
                <span class="help">{colsNote(n)}</span>
              </label>
            )}
          </For>
        </div>
      </Show>
      <button type="submit" class="btn btn-primary" disabled={busy() || chosen().length === 0 || !props.connId}>
        {countText("ds.start", chosen().length)}
      </button>
      <span class="help">{t(props.onSearch ? "ds.hintDocked" : "ds.hint")}</span>
    </form>
  );

  return (
    <Panel title={t("tool.search.tab")} class={props.onSearch ? "ds-docked" : "ds-tab"}>
      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>
      <Show when={props.db || db()} fallback={<EmptyNote title={t("ds.noDb")} />}>
        <Show when={!props.onSearch} fallback={form}>
          <div class="ds-layout">
            {form}
            <section class="ds-results" aria-label={t("ds.results")}>
              <Show when={progress()}>
                {(p) => (
                  <div class="ds-progress" role="status">
                    <div class="ds-progress-line">
                      <span>
                        <b>{t("ds.progress", { i: p().i, total: p().total })}</b> · {p().table} ·{" "}
                        {countText("ds.soFar", rowsFound())}
                      </span>
                      <span class="panel-bar-spacer" />
                      <button type="button" class="btn" onClick={cancel} title={t("ds.cancelTitle")}>
                        {t("common.cancel")}
                      </button>
                    </div>
                    <div
                      class="ds-bar"
                      role="progressbar"
                      aria-label={t("ds.progressAria")}
                      aria-valuemin={0}
                      aria-valuemax={p().total}
                      aria-valuenow={p().i - 1}
                      aria-valuetext={t("ds.progress", { i: p().i, total: p().total })}
                    >
                      <span style={{ width: `${((p().i - 1) / p().total) * 100}%` }} />
                    </div>
                  </div>
                )}
              </Show>
              <Show when={last()}>
                {(l) => (
                  <div class="ds-summary" role="status">
                    <b>{countText("ds.found", rowsFound())}</b>{" "}
                    {t("ds.summaryIn", { text: l().req.opts.text, hits: hits().length, total: results().length })}
                    <Show when={l().stopped}>
                      {" · "}
                      {t("ds.stoppedNote", { searched: results().length, total: l().req.tables.length })}
                    </Show>
                    <Show when={skippedNote()}>
                      <span class="help"> · {skippedNote()}</span>
                    </Show>
                  </div>
                )}
              </Show>
              <Show when={results().length > 0}>
                <div class="ds-split">
                  <nav class="ds-list" aria-label={t("ds.tablesSearched")}>
                    <For each={results()}>
                      {(r) => (
                        <button
                          type="button"
                          class="ds-item"
                          aria-current={openTable() === r.table ? "true" : undefined}
                          disabled={r.count === 0 && !r.error}
                          onClick={() => setOpenTable(r.table)}
                        >
                          <span class="ds-table-name">{r.table}</span>
                          <Show when={r.skipped || r.error}>
                            <span class="help">{r.error ? t("ds.failed") : t(r.skipped!)}</span>
                          </Show>
                          <span class="chip">{matchLabel(r)}</span>
                        </button>
                      )}
                    </For>
                  </nav>
                  <div class="ds-matches">
                    <Show
                      when={opened()}
                      fallback={
                        <EmptyNote
                          title={
                            last() && hits().length === 0
                              ? t("ds.noHits", { text: last()!.req.opts.text })
                              : t("ds.pickTable")
                          }
                        />
                      }
                    >
                      {(r) => (
                        <Show
                          when={!r().error}
                          fallback={
                            <div class="grid-error" role="alert">
                              {r().error}
                            </div>
                          }
                        >
                          <div class="ds-matches-bar">
                            <span>
                              <b>{r().table}</b> ·{" "}
                              {countText("ds.rowsWith", r().count, { n: matchLabel(r()), text: last()?.req.opts.text ?? text() })}{" "}
                              <span class="help">{(r().columns ?? []).join(", ")}</span>
                            </span>
                            <span class="panel-bar-spacer" />
                            <Show when={r().openSql}>
                              <button
                                type="button"
                                class="btn btn-primary"
                                title={r().openSql}
                                onClick={() => props.onOpen(r().openSql!, r().table)}
                              >
                                {t("ds.openFiltered", { table: r().table })}
                              </button>
                            </Show>
                          </div>
                          <Show when={r().capped}>
                            <p class="help">{t("ds.capped", { n: r().count })}</p>
                          </Show>
                          <div class="ds-grid">
                            <ResultGrid
                              result={r().matches ? { ...r().matches!, truncated: false, rowsAffected: 0 } : null}
                              loading={false}
                              error={null}
                            />
                          </div>
                        </Show>
                      )}
                    </Show>
                  </div>
                </div>
              </Show>
            </section>
          </div>
        </Show>
      </Show>
    </Panel>
  );
}
