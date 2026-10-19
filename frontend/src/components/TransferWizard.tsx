import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import type { ResultSet } from "../utils/query";
import { QueryError, drainQuery } from "../utils/query";
import { schemaDescribe, schemaTree, parseTreeRows, qualifiedName } from "../utils/schema";
import { openSaved, closeConnection } from "../utils/conn";
import { rowInsert, txBegin, txCommit, txRollback } from "../utils/edit";
import {
  hasMapping,
  mapByName,
  runImport,
  targetColumns,
  type ColumnMapping,
  type ErrorPolicy,
  type ImportError,
  type ImportOps,
  type ImportSummary,
  type ParsedTable,
  type TargetColumn,
} from "../utils/importers";
import type { Connection } from "../utils/connections";
import { Dropdown } from "./Dropdown";
import { isReadOnlyTarget, targetOptions } from "../utils/wizard";
import { RowErrorPolicy, Wizard, WizardField, WizardSummary } from "./Wizard";
import { ColumnMapper } from "./ColumnMapper";
import { RunErrors, RunProgress } from "./RunProgress";
import { countText } from "../utils/confirmText";
import { formatElapsed } from "../utils/duration";

/** Rows per page when the whole source is read. */
const PAGE = 1000;

/** A run in flight: reading the source (total unknown), then writing. */
interface Running {
  phase: "read" | "write";
  startedAt: number;
  done: number;
  total: number | null;
  errors: ImportError[];
}

/**
 * Data transfer wizard (#33, #692): copy the current table's rows into a table
 * on another connection (same or a different engine). The destination's
 * databases and tables are offered once its connection is chosen; its columns
 * come from schema.describe, mapped with the import's typed mapper (values
 * cross as text and the target engine coerces them). Client-side, opening a
 * second connection for the target (M9 decision). Given `whole`, the default is
 * the whole source table, read page by page on its own session; the loaded or
 * marked rows remain a choice. Reading and writing show determinate progress
 * with the errors as they happen, and can be cancelled (rolled back); the
 * result is a summary card with the failed rows listed.
 */
export function TransferWizard(props: {
  sourceResult: ResultSet;
  sourceTable: string;
  /** Where the source table lives, to read all of it; absent when only the
      rows handed in (marked rows) are to be copied. */
  whole?: { defId: string; db?: string; schema?: string };
  connections: Connection[];
  onClose: () => void;
}) {
  const [destDefId, setDestDefId] = createSignal(props.connections[0]?.id ?? "");
  const [destTable, setDestTable] = createSignal(props.sourceTable);
  const [destDb, setDestDb] = createSignal("");
  const [destCols, setDestCols] = createSignal<TargetColumn[] | null>(null);
  /** What the destination offers, read when its connection is chosen. */
  const [dbChoices, setDbChoices] = createSignal<string[]>([]);
  const [tableChoices, setTableChoices] = createSignal<string[]>([]);
  const [mapping, setMapping] = createSignal<ColumnMapping>({});
  const [policy, setPolicy] = createSignal<ErrorPolicy>("skip");
  const [busy, setBusy] = createSignal(false);
  const [summary, setSummary] = createSignal<(ImportSummary & { ms: number }) | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [scope, setScope] = createSignal<"all" | "loaded">(props.whole ? "all" : "loaded");
  const [running, setRunning] = createSignal<Running | null>(null);
  /** Rows read from the source when the whole table was copied. */
  const [read, setRead] = createSignal<number | null>(null);

  let destConnId: string | null = null;
  let destOpenFor = "";
  let ctl: AbortController | null = null;
  const closeDest = () => {
    if (destConnId) {
      void closeConnection(destConnId);
      destConnId = null;
      destOpenFor = "";
    }
  };
  onCleanup(() => {
    ctl?.abort();
    closeDest();
  });

  const errMsg = (e: unknown) => (e instanceof QueryError ? e.message : String(e));
  const sourceHeaders = () => props.sourceResult.columns.map((c) => c.name);
  const destDef = () => props.connections.find((c) => c.id === destDefId());

  /** The destination's session, opened once per chosen connection. */
  const ensureDest = async (): Promise<string> => {
    const def = destDef();
    if (!def) throw new Error(t("tw.pickTarget"));
    if (destConnId && destOpenFor === def.id) return destConnId;
    closeDest();
    destConnId = await openSaved(def);
    destOpenFor = def.id;
    return destConnId;
  };

  /** The destination's tables in `db` (or at its top level), for the picker. */
  const loadTables = async (connId: string, db: string) => {
    const rows = parseTreeRows(await schemaTree(connId, db || undefined), "schema");
    setTableChoices(rows.filter((r) => r.kind === "table").map((r) => r.name));
  };

  // A connection chosen: offer its databases and tables. Best-effort — a
  // catalog that cannot be listed leaves both fields free to type in.
  const chooseConnection = async (id: string) => {
    setDestDefId(id);
    setDbChoices([]);
    setTableChoices([]);
    setDestDb("");
    try {
      const connId = await ensureDest();
      const top = parseTreeRows(await schemaTree(connId), "database");
      const containers = top.filter((r) => r.kind === "database" || r.kind === "schema").map((r) => r.name);
      setDbChoices(containers);
      if (containers.length === 0) setTableChoices(top.filter((r) => r.kind === "table").map((r) => r.name));
    } catch {
      /* the fields stay free text */
    }
  };
  onMount(() => {
    if (destDefId()) void chooseConnection(destDefId());
  });
  const chooseDb = async (db: string) => {
    setDestDb(db);
    setTableChoices([]);
    if (!destConnId) return;
    try {
      await loadTables(destConnId, db);
    } catch {
      /* free text */
    }
  };

  // Read the destination table's columns to map onto.
  const prepare = async () => {
    if (!destDef() || !destTable().trim()) {
      setError(t("tw.pickTarget"));
      return;
    }
    setBusy(true);
    setError(null);
    setSummary(null);
    setDestCols(null);
    try {
      const connId = await ensureDest();
      const desc = await schemaDescribe(connId, destTable().trim(), destDb() || undefined);
      const cols = targetColumns(desc, destDef()?.driver);
      if (cols.length === 0) {
        setError(t("tw.noTargetColumns"));
        return;
      }
      setDestCols(cols);
      // A copy keeps its keys: an autoincrement column is mapped like any other.
      setMapping(mapByName(sourceHeaders(), cols, false));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const transfer = async () => {
    if (!destConnId || !hasMapping(mapping())) return;
    const connId = destConnId;
    const target = { table: destTable().trim(), db: destDb() || undefined };
    const run = new AbortController();
    ctl = run;
    const startedAt = Date.now();
    setError(null);
    setRead(null);
    const ops: ImportOps = {
      begin: () => txBegin(connId),
      commit: () => txCommit(connId),
      rollback: () => txRollback(connId),
      insert: async (values) => {
        await rowInsert(connId, target, values, false);
      },
    };
    let sourceConnId: string | null = null;
    try {
      let data: ParsedTable = { headers: sourceHeaders(), rows: props.sourceResult.rows };
      const whole = props.whole;
      if (scope() === "all" && whole) {
        const srcDef = props.connections.find((c) => c.id === whole.defId);
        if (!srcDef) throw new Error(t("ddiff.noSource"));
        setRunning({ phase: "read", startedAt, done: 0, total: null, errors: [] });
        // Its own session: the grid's tab keeps its cursor on the workspace one.
        sourceConnId = await openSaved(srcDef);
        const ref = qualifiedName({ db: whole.db, schema: whole.schema, name: props.sourceTable }, srcDef.driver);
        const res = await drainQuery(
          sourceConnId,
          `SELECT * FROM ${ref}`,
          PAGE,
          (n) => setRunning((r) => r && { ...r, done: n }),
          run.signal,
        );
        data = { headers: res.columns.map((c) => c.name), rows: res.rows };
        setRead(res.rows.length);
      }
      const rows = data;
      setRunning({ phase: "write", startedAt: Date.now(), done: 0, total: rows.rows.length, errors: [] });
      const result = await withWriteConsent(connId, [`INSERT INTO ${target.table} … (${rows.rows.length})`], () =>
        runImport(rows, mapping(), policy(), ops, {
          onProgress: (done) => setRunning((r) => r && { ...r, done }),
          onError: (e) => setRunning((r) => r && { ...r, errors: [...r.errors, e] }),
          signal: run.signal,
        }),
      );
      setSummary({ ...result, ms: Date.now() - startedAt });
    } catch (err) {
      setError(run.signal.aborted ? t("tw.cancelled") : errMsg(err));
    } finally {
      if (sourceConnId) void closeConnection(sourceConnId);
      if (ctl === run) ctl = null;
      setRunning(null);
    }
  };

  // 0 where to, 1 columns, 2 the run and its result.
  const step = () => (summary() || running() ? 2 : destCols() ? 1 : 0);
  const destName = () => destDef()?.name ?? "";
  // A read-only destination would refuse every row: said up front (audit P1).
  const readOnly = () => isReadOnlyTarget(destDef());
  const destRef = () => `${destName()} › ${destDb() ? `${destDb()}.` : ""}${destTable().trim()}`;
  const errorsOf = (errs: ImportError[]) =>
    errs.map((e) => ({ where: t("imp.rowN", { n: e.row + 1 }), message: e.message }));
  const policyText = () => (policy() === "skip" ? t("tw.policySkipNote") : t("imp.policyAbortNote"));

  return (
    <Panel wide onClose={props.onClose} dirty={busy() || !!running() || (!!destCols() && !summary())}>
      <Wizard
        title={t("tw.title", { name: props.sourceTable })}
        subtitle={
          step() === 0
            ? t(props.sourceResult.truncated ? "ddiff.sourceTruncated" : "ddiff.source", {
                n: props.sourceResult.rows.length,
              })
            : t("tw.destSubtitle", { dest: destRef() })
        }
        steps={[t("tw.step.target"), t("tw.step.columns"), t("tw.step.transfer")]}
        step={step()}
        error={error()}
        busy={busy()}
        busyLabel={t("tw.preparing")}
        onBack={step() === 1 ? () => setDestCols(null) : undefined}
        primary={
          step() === 0
            ? { label: t("wiz.next"), onClick: () => void prepare(), disabled: !destDefId() || !destTable().trim() || readOnly() }
            : step() === 1
              ? {
                  label:
                    scope() === "all"
                      ? t("tw.transferAll", { target: destName() })
                      : countText("tw.transferN", props.sourceResult.rows.length, { target: destName() }),
                  onClick: () => void transfer(),
                  disabled: !hasMapping(mapping()),
                }
              : undefined
        }
        cancelLabel={running() ? t("tw.cancelRun") : step() === 2 ? t("common.close") : undefined}
        onCancel={running() ? () => ctl?.abort() : props.onClose}
      >
        <Show when={step() === 0}>
          <div class="wiz-form">
            <WizardField label={t("tw.source")}>
              <span>{props.sourceTable}</span>
            </WizardField>
            <Show when={props.whole}>
              <div class="wiz-row" role="radiogroup" aria-label={t("tw.rows")}>
                <span class="wiz-label">{t("tw.rows")}</span>
                <span class="wiz-ctl wiz-radios">
                  <label>
                    <input type="radio" name="tscope" checked={scope() === "all"} onChange={() => setScope("all")} />
                    {t("tw.scopeAll")}
                  </label>
                  <label>
                    <input type="radio" name="tscope" checked={scope() === "loaded"} onChange={() => setScope("loaded")} />
                    {countText("tw.scopeLoaded", props.sourceResult.rows.length)}
                  </label>
                </span>
                <p class="help wiz-help">{t("tw.scopeHelp")}</p>
              </div>
            </Show>
            <WizardField label={t("tw.targetConn")} help={t("tw.targetHelp")}>
              <Dropdown
                value={destDefId()}
                options={targetOptions(props.connections)}
                onChange={(v) => void chooseConnection(v)}
              />
            </WizardField>
            <Show when={readOnly()}>
              <p class="help" role="note">
                {t("wiz.readOnlyNoTransfer", { name: destName() })}
              </p>
            </Show>
            <WizardField label={t("wiz.db")}>
              <input
                type="text"
                list="tw-dbs"
                value={destDb()}
                placeholder={t("ssync.dbDefault")}
                onChange={(e) => void chooseDb(e.currentTarget.value)}
              />
              <datalist id="tw-dbs">
                <For each={dbChoices()}>{(d) => <option value={d} />}</For>
              </datalist>
            </WizardField>
            <WizardField label={t("tw.table")} help={t("tw.tableHelp")}>
              <input type="text" list="tw-tables" value={destTable()} onInput={(e) => setDestTable(e.currentTarget.value)} />
              <datalist id="tw-tables">
                <For each={tableChoices()}>{(name) => <option value={name} />}</For>
              </datalist>
            </WizardField>
          </div>
        </Show>

        <Show when={step() === 1 && destCols()}>
          {(cols) => (
            <>
              <div class="wiz-form">
                <WizardField label={t("tw.source")}>
                  <span>
                    {scope() === "all"
                      ? t("tw.sourceAll", { table: props.sourceTable })
                      : countText("tw.sourceRows", props.sourceResult.rows.length, { table: props.sourceTable })}
                  </span>
                </WizardField>
                <WizardField label={t("tw.dest")}>
                  <span>{destRef()}</span>
                  <button type="button" class="btn" onClick={() => setDestCols(null)}>
                    {t("tw.changeDest")}
                  </button>
                </WizardField>
              </div>
              <ColumnMapper
                targets={cols()}
                sourceHeaders={sourceHeaders()}
                mapping={mapping()}
                onChange={setMapping}
                example={props.sourceResult.rows[0]}
                skipAuto={false}
              />
              <div class="wiz-form">
                <RowErrorPolicy name="tpolicy" value={policy()} onChange={setPolicy} />
                <WizardField label={t("imp.transaction")}>
                  <span>{t("tw.txHelp", { target: destName() })}</span>
                </WizardField>
              </div>
            </>
          )}
        </Show>

        <Show when={running()}>
          {(r) => (
            <RunProgress
              title={
                r().phase === "read"
                  ? t("tw.readingTitle", { table: props.sourceTable })
                  : t("tw.writingTitle", { dest: destRef() })
              }
              done={r().done}
              total={r().total}
              unit="rows"
              startedAt={r().startedAt}
              counts={
                r().phase === "write"
                  ? [
                      { label: countText("tw.writtenN", r().done - r().errors.length) },
                      ...(r().errors.length > 0
                        ? [{ label: countText("imp.failedN", r().errors.length), tone: "error" as const }]
                        : []),
                    ]
                  : []
              }
              errors={errorsOf(r().errors)}
              errorPolicy={policyText()}
              note={t("tw.cancelNote", { target: destName() })}
            />
          )}
        </Show>

        <Show when={summary()}>
          {(sum) => (
            <>
              <p role="status">
                {sum().aborted ? t("tw.abortedResult", { dest: destRef() }) : t("tw.doneResult", { dest: destRef() })}
              </p>
              <WizardSummary
                stats={[
                  ...(read() !== null ? [{ value: read()!, label: t("tw.stat.read") }] : []),
                  { value: sum().inserted, label: t("tw.stat.written") },
                  { value: sum().errors.length, label: t("imp.stat.failed"), error: sum().errors.length > 0 },
                  { value: formatElapsed(sum().ms), label: t("imp.stat.time") },
                ]}
              />
              <RunErrors
                errors={errorsOf(sum().errors)}
                title={countText("imp.failedRows", sum().errors.length)}
                policy={sum().aborted ? t("imp.policyAbortNote") : t("tw.policySkipNote")}
              />
            </>
          )}
        </Show>
      </Wizard>
    </Panel>
  );
}
