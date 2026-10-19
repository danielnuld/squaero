import { For, Show, createSignal, onCleanup } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import type { ResultSet } from "../utils/query";
import { QueryError } from "../utils/query";
import { schemaDescribe } from "../utils/schema";
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

/**
 * Data transfer wizard (#33): copy the current table's loaded rows into a table
 * on another connection (same or a different engine). The source rows are the
 * grid's result; the destination columns come from schema.describe on the opened
 * target connection; mapping + the transactional insert reuse the import path
 * (values cross as text and the target engine coerces them, which is how types
 * convert across engines). Client-side, opening a second connection for the
 * target (M9 decision). Bounded to the loaded rows.
 */
export function TransferWizard(props: {
  sourceResult: ResultSet;
  sourceTable: string;
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

  let destConnId: string | null = null;
  const closeDest = () => {
    if (destConnId) {
      void closeConnection(destConnId);
      destConnId = null;
    }
  };
  onCleanup(closeDest);

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
    setBusy(true);
    setError(null);
    const ops: ImportOps = {
      begin: () => txBegin(connId),
      commit: () => txCommit(connId),
      rollback: () => txRollback(connId),
      insert: async (values) => {
        await rowInsert(connId, target, values, false);
      },
    };
    try {
      const data = sourceTableData();
      setSummary(
        await withWriteConsent(connId, [`INSERT INTO ${target.table} … (${data.rows.length})`], () =>
          runImport(data, mapping(), policy(), ops),
        ),
      );
    } catch (err) {
      setError(errMsg(err));
    } finally {
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
                  label: countText("tw.transferN", props.sourceResult.rows.length, { target: destName() }),
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
            </div>
          )}
        </Show>
      </Wizard>
    </Panel>
  );
}
