import { For, Show, createSignal, onCleanup } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import type { ResultSet } from "../utils/query";
import { QueryError, drainQuery } from "../utils/query";
import { schemaDescribe, qualifiedName } from "../utils/schema";
import { openSaved, closeConnection } from "../utils/conn";
import { rowInsert, txBegin, txCommit, txRollback } from "../utils/edit";
import {
  autoMap,
  hasMapping,
  runImport,
  type ColumnMapping,
  type ErrorPolicy,
  type ImportOps,
  type ImportSummary,
  type ParsedTable,
} from "../utils/importers";
import type { Connection } from "../utils/connections";
import { Dropdown } from "./Dropdown";
import { RowErrorPolicy, Wizard, WizardField } from "./Wizard";
import { countText } from "../utils/confirmText";

const OMIT = "";
/** Rows per page when the whole source is read. */
const PAGE = 1000;

/**
 * Data transfer wizard (#33): copy the current table's loaded rows into a table
 * on another connection (same or a different engine). The source rows are the
 * grid's result; the destination columns come from schema.describe on the opened
 * target connection; mapping + the transactional insert reuse the import path
 * (values cross as text and the target engine coerces them, which is how types
 * convert across engines). Client-side, opening a second connection for the
 * target (M9 decision). Given `whole`, the default is the whole source table,
 * read page by page on its own session (#692); the loaded or marked rows
 * remain a choice. Reading and writing show progress and can be cancelled.
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
  const [destCols, setDestCols] = createSignal<string[] | null>(null);
  const [mapping, setMapping] = createSignal<ColumnMapping>({});
  const [policy, setPolicy] = createSignal<ErrorPolicy>("skip");
  const [busy, setBusy] = createSignal(false);
  const [summary, setSummary] = createSignal<ImportSummary | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [scope, setScope] = createSignal<"all" | "loaded">(props.whole ? "all" : "loaded");
  const [progress, setProgress] = createSignal<string | null>(null);
  /** Rows read from the source when the whole table was copied. */
  const [read, setRead] = createSignal<number | null>(null);

  let destConnId: string | null = null;
  let running: AbortController | null = null;
  const closeDest = () => {
    if (destConnId) {
      void closeConnection(destConnId);
      destConnId = null;
    }
  };
  onCleanup(() => {
    running?.abort();
    closeDest();
  });

  const errMsg = (e: unknown) => (e instanceof QueryError ? e.message : String(e));
  const sourceHeaders = () => props.sourceResult.columns.map((c) => c.name);
  const sourceTableData = (): ParsedTable => ({
    headers: sourceHeaders(),
    rows: props.sourceResult.rows,
  });

  // Open the target and read the destination table's columns to map onto.
  const prepare = async () => {
    const def = props.connections.find((c) => c.id === destDefId());
    if (!def || !destTable().trim()) {
      setError(t("tw.pickTarget"));
      return;
    }
    setBusy(true);
    setError(null);
    setSummary(null);
    setDestCols(null);
    try {
      closeDest();
      destConnId = await openSaved(def);
      const desc = await schemaDescribe(
        destConnId,
        destTable().trim(),
        destDb() || undefined,
      );
      const nameIdx = desc.columns.findIndex((c) => c.name === "name");
      const cols =
        nameIdx === -1
          ? []
          : desc.rows.map((r) => r[nameIdx]).filter((n): n is string => n !== null);
      if (cols.length === 0) {
        setError(t("tw.noTargetColumns"));
        return;
      }
      setDestCols(cols);
      setMapping(autoMap(sourceHeaders(), cols));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const setColumn = (target: string, source: string) =>
    setMapping((m) => ({ ...m, [target]: source === OMIT ? null : source }));

  const transfer = async () => {
    if (!destConnId || !hasMapping(mapping())) return;
    const connId = destConnId;
    const target = {
      table: destTable().trim(),
      db: destDb() || undefined,
    };
    const ctl = new AbortController();
    running = ctl;
    setBusy(true);
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
      let data = sourceTableData();
      const whole = props.whole;
      const srcDef = whole && props.connections.find((c) => c.id === whole.defId);
      if (scope() === "all" && whole) {
        if (!srcDef) throw new Error(t("ddiff.noSource"));
        // Its own session: the grid's tab keeps its cursor on the workspace one.
        sourceConnId = await openSaved(srcDef);
        const ref = qualifiedName({ db: whole.db, schema: whole.schema, name: props.sourceTable }, srcDef.driver);
        const res = await drainQuery(
          sourceConnId,
          `SELECT * FROM ${ref}`,
          PAGE,
          (n) => setProgress(t("ddiff.readingSource", { n })),
          ctl.signal,
        );
        data = { headers: res.columns.map((c) => c.name), rows: res.rows };
        setRead(res.rows.length);
      }
      const rows = data;
      setSummary(
        await withWriteConsent(connId, [`INSERT INTO ${target.table} … (${rows.rows.length})`], () =>
          runImport(rows, mapping(), policy(), ops, {
            onProgress: (done, total) => setProgress(t("tw.writing", { done, total })),
            signal: ctl.signal,
          }),
        ),
      );
    } catch (err) {
      setError(ctl.signal.aborted ? t("tw.cancelled") : errMsg(err));
    } finally {
      if (sourceConnId) void closeConnection(sourceConnId);
      if (running === ctl) running = null;
      setProgress(null);
      setBusy(false);
    }
  };

  // 0 where to, 1 columns, 2 the result.
  const step = () => (summary() ? 2 : destCols() ? 1 : 0);
  const destName = () => props.connections.find((c) => c.id === destDefId())?.name ?? "";

  return (
    <Panel wide onClose={props.onClose}>
      <Wizard
        title={t("tw.title", { name: props.sourceTable })}
        subtitle={t(props.sourceResult.truncated ? "ddiff.sourceTruncated" : "ddiff.source", {
          n: props.sourceResult.rows.length,
        })}
        steps={[t("tw.step.target"), t("tw.step.columns"), t("tw.step.transfer")]}
        step={step()}
        error={error()}
        busy={busy()}
        busyLabel={step() === 0 ? t("tw.preparing") : t("tw.transferring")}
        onBack={step() === 1 ? () => setDestCols(null) : undefined}
        primary={
          step() === 0
            ? { label: t("wiz.next"), onClick: () => void prepare(), disabled: !destDefId() || !destTable().trim() }
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
        cancelLabel={step() === 2 ? t("common.close") : undefined}
        onCancel={props.onClose}
      >
        <Show when={step() === 0}>
          <div class="wiz-form">
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
                options={props.connections.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(v) => setDestDefId(v)}
              />
            </WizardField>
            <WizardField label={t("wiz.db")}>
              <input
                type="text"
                value={destDb()}
                placeholder={t("ssync.dbDefault")}
                onInput={(e) => setDestDb(e.currentTarget.value)}
              />
            </WizardField>
            <WizardField label={t("tw.table")} help={t("tw.tableHelp")}>
              <input type="text" value={destTable()} onInput={(e) => setDestTable(e.currentTarget.value)} />
            </WizardField>
          </div>
        </Show>

        <Show when={step() === 1 && destCols()}>
          {(cols) => (
            <>
              <h3>{t("imp.mappingTarget")}</h3>
              <div class="import-mapping">
                <For each={cols()}>
                  {(col) => (
                    <div class="map-row">
                      <span class="map-target">{col}</span>
                      <span class="map-arrow">←</span>
                      <Dropdown
                        value={mapping()[col] ?? OMIT}
                        options={[{ value: OMIT, label: t("imp.omit") }, ...sourceHeaders().map((h) => ({ value: h, label: h }))]}
                        onChange={(v) => setColumn(col, v)}
                        class="map-select"
                      />
                    </div>
                  )}
                </For>
              </div>
              <div class="wiz-form">
                <RowErrorPolicy name="tpolicy" value={policy()} onChange={setPolicy} />
              </div>
              <p class="help">{t("imp.txHelp")}</p>
              <Show when={progress()}>
                <p class="import-subtitle" role="status">
                  {progress()}{" "}
                  <button type="button" class="btn" onClick={() => running?.abort()}>
                    {t("common.cancel")}
                  </button>
                </p>
              </Show>
            </>
          )}
        </Show>

        <Show when={summary()}>
          {(sum) => (
            <div class="import-summary">
              <p>
                <strong>{sum().inserted}</strong> {t("imp.transferred")}
                {sum().aborted
                  ? t("imp.aborted")
                  : sum().errors.length > 0
                    ? t("imp.withErrors", { n: sum().errors.length })
                    : t("imp.done")}
              </p>
              <Show when={read() !== null}>
                <p class="help">{countText("tw.readTotal", read()!)}</p>
              </Show>
            </div>
          )}
        </Show>
      </Wizard>
    </Panel>
  );
}
