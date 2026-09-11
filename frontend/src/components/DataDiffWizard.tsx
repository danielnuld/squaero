import { For, Show, createSignal, onCleanup } from "solid-js";
import { Panel } from "./Panel";
import { runQuery, QueryError, type ResultSet } from "../utils/query";
import { qualifiedName } from "../utils/schema";
import { openConnection, closeConnection } from "../utils/conn";
import { runPlanItem, txBegin, txCommit, txRollback } from "../utils/edit";
import { diffData, dataDiffEmpty, diffToPlan } from "../utils/dataDiff";
import { buildDsn, type Connection } from "../utils/connections";
import { t } from "../utils/i18n";
import type { PlanItem } from "../utils/editSession";

/**
 * Data diff / sync wizard (#35). Compares the current table's rows (source) with
 * the same table on a chosen target connection, keyed by primary key, and
 * derives the INSERT/UPDATE/DELETE that make the target match the source. The SQL
 * is previewed before applying; applying runs it on the target inside a
 * transaction (reusing the row.* path). Bounded to the loaded rows on each side.
 */
export function DataDiffWizard(props: {
  sourceResult: ResultSet;
  source: { table: string; db?: string; schema?: string };
  pk: string[];
  connections: Connection[];
  onClose: () => void;
}) {
  const [targetDefId, setTargetDefId] = createSignal(props.connections[0]?.id ?? "");
  const [targetDb, setTargetDb] = createSignal(props.source.db ?? "");
  const [plan, setPlan] = createSignal<PlanItem[] | null>(null);
  const [preview, setPreview] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [applied, setApplied] = createSignal<string | null>(null);

  let targetConnId: string | null = null;
  const closeTarget = () => {
    if (targetConnId) {
      void closeConnection(targetConnId);
      targetConnId = null;
    }
  };
  onCleanup(closeTarget);

  const errMsg = (e: unknown) => (e instanceof QueryError ? e.message : String(e));
  const target = () => ({
    table: props.source.table,
    db: targetDb() || undefined,
    schema: props.source.schema,
  });

  const targetEngine = () =>
    props.connections.find((c) => c.id === targetDefId())?.driver ?? "";
  const qualifiedTarget = () =>
    qualifiedName({ db: targetDb(), name: props.source.table }, targetEngine());

  const compare = async () => {
    const def = props.connections.find((c) => c.id === targetDefId());
    if (!def) {
      setError(t("ssync.pickTarget"));
      return;
    }
    setBusy(true);
    setError(null);
    setPlan(null);
    setApplied(null);
    try {
      closeTarget();
      targetConnId = await openConnection(def.driver, buildDsn(def));
      const targetRows = await runQuery(
        targetConnId,
        `SELECT * FROM ${qualifiedTarget()}`,
      );
      const diff = diffData(props.sourceResult, targetRows, props.pk);
      const items = diffToPlan(diff);
      // Gather the exact SQL for each op (preview) on the target.
      const sqls: string[] = [];
      for (const item of items) {
        const r = await runPlanItem(targetConnId, target(), item, true);
        sqls.push(r.sql);
      }
      setPreview(sqls);
      setPlan(items);
      if (dataDiffEmpty(diff)) {
        setError(null);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    const items = plan();
    if (!items || items.length === 0 || !targetConnId) return;
    setBusy(true);
    setError(null);
    try {
      await txBegin(targetConnId);
      try {
        for (const item of items) {
          await runPlanItem(targetConnId, target(), item, false);
        }
        await txCommit(targetConnId);
        setApplied(t("ddiff.applied", { n: items.length }));
        setPlan(null);
      } catch (err) {
        await txRollback(targetConnId).catch(() => {});
        throw err;
      }
    } catch (err) {
      setError(t("ssync.applyError", { reason: errMsg(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel wide onClose={props.onClose}>
        <h2>{t("ddiff.title", { name: props.source.table })}</h2>
        <p class="import-subtitle">
          {t(props.sourceResult.truncated ? "ddiff.sourceTruncated" : "ddiff.source", {
            n: props.sourceResult.rows.length,
          })}
        </p>

        <div class="import-field">
          <label>
            {t("ssync.target")}{" "}
            <select
              value={targetDefId()}
              onChange={(e) => setTargetDefId(e.currentTarget.value)}
            >
              <For each={props.connections}>
                {(c) => <option value={c.id}>{c.name}</option>}
              </For>
            </select>
          </label>{" "}
          <label>
            {t("ssync.db")}{" "}
            <input
              type="text"
              value={targetDb()}
              placeholder={t("ssync.dbDefault")}
              onInput={(e) => setTargetDb(e.currentTarget.value)}
            />
          </label>{" "}
          <button class="edit-btn" disabled={busy()} onClick={compare}>
            {t("ssync.compare")}
          </button>
        </div>

        <Show when={error()}>
          <div class="grid-error" role="alert">
            {error()}
          </div>
        </Show>

        <Show when={plan()}>
          {(items) => (
            <>
              <div class="import-subtitle">
                {t("ddiff.opsToMatch", { n: items().length })}
              </div>
              <Show
                when={items().length > 0}
                fallback={<p>{t("ddiff.alreadyMatch")}</p>}
              >
                <pre class="ddl-text preview-sql">{preview().join(";\n")}</pre>
              </Show>
            </>
          )}
        </Show>

        <Show when={applied()}>
          <p class="import-applied">{applied()}</p>
        </Show>

        <div class="modal-actions">
          <button onClick={props.onClose}>{t("common.close")}</button>
          <Show when={plan() && plan()!.length > 0 && !applied()}>
            <button class="primary" disabled={busy()} onClick={apply}>
              {busy() ? t("ssync.applying") : t("ddiff.apply", { n: plan()!.length })}
            </button>
          </Show>
        </div>
    </Panel>
  );
}
