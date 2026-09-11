import { For, Show, createSignal, onCleanup } from "solid-js";
import { Panel } from "./Panel";
import { schemaTree, schemaDescribe } from "../utils/schema";
import { parseStructure, buildSchemaSync, isExecutable, type SchemaEndpoint } from "../utils/schemaDiff";
import { openConnection, closeConnection } from "../utils/conn";
import { runQuery, QueryError } from "../utils/query";
import { txBegin, txCommit, txRollback } from "../utils/edit";
import { buildDsn, type Connection } from "../utils/connections";
import { t } from "../utils/i18n";

/**
 * Schema-diff / structure-sync wizard (#34). Compares the SOURCE database (the
 * active connection's current db) against a chosen TARGET connection's database
 * and shows the migration SQL that would make the target match the source
 * (CREATE / ALTER for tables and columns). The user reviews it before applying;
 * applying runs the executable statements on the target inside a transaction.
 * A second connection is opened client-side for the target (the M9 decision).
 */
export function SchemaSyncWizard(props: {
  sourceConnId: string;
  sourceDb?: string;
  connections: Connection[];
  onClose: () => void;
}) {
  const [targetDefId, setTargetDefId] = createSignal(props.connections[0]?.id ?? "");
  const [targetDb, setTargetDb] = createSignal(props.sourceDb ?? "");
  const [statements, setStatements] = createSignal<string[] | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [applied, setApplied] = createSignal<string | null>(null);

  // The target connection is opened for the compare and closed on unmount.
  let targetConnId: string | null = null;
  const closeTarget = () => {
    if (targetConnId) {
      void closeConnection(targetConnId);
      targetConnId = null;
    }
  };
  onCleanup(closeTarget);

  const errMsg = (e: unknown) => (e instanceof QueryError ? e.message : String(e));

  const endpoint = (connId: string, db: string | undefined): SchemaEndpoint => ({
    tables: async () => {
      const tree = await schemaTree(connId, db);
      const nameIdx = tree.columns.findIndex((c) => c.name === "name");
      return nameIdx === -1
        ? []
        : tree.rows.map((r) => r[nameIdx]).filter((n): n is string => n !== null);
    },
    structure: async (t) => parseStructure(await schemaDescribe(connId, t, db)),
  });

  const compare = async () => {
    const def = props.connections.find((c) => c.id === targetDefId());
    if (!def) {
      setError(t("ssync.pickTarget"));
      return;
    }
    setBusy(true);
    setError(null);
    setStatements(null);
    setApplied(null);
    try {
      closeTarget();
      targetConnId = await openConnection(def.driver, buildDsn(def));
      const source = endpoint(props.sourceConnId, props.sourceDb);
      const target = endpoint(targetConnId, targetDb() || undefined);
      const { statements: sql } = await buildSchemaSync(source, target);
      setStatements(sql);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    const sql = statements();
    if (!sql || !targetConnId) return;
    const executable = sql.filter(isExecutable);
    if (executable.length === 0) {
      setError(t("ssync.nothingExecutable"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await txBegin(targetConnId);
      try {
        for (const stmt of executable) {
          await runQuery(targetConnId, stmt);
        }
        await txCommit(targetConnId);
        setApplied(t("ssync.applied", { n: executable.length }));
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
        <h2>{t("ssync.title")}</h2>
        <p class="import-subtitle">
          {props.sourceDb ? t("ssync.sourceDb", { db: props.sourceDb }) : t("ssync.source")}
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

        <Show when={statements()}>
          {(sql) => (
            <>
              <div class="import-subtitle">
                {t("ssync.migrationSql", { n: sql().filter(isExecutable).length })}
              </div>
              <Show
                when={sql().length > 0}
                fallback={<p>{t("ssync.alreadyMatch")}</p>}
              >
                <pre class="ddl-text preview-sql">{sql().join("\n")}</pre>
              </Show>
            </>
          )}
        </Show>

        <Show when={applied()}>
          <p class="import-applied">{applied()}</p>
        </Show>

        <div class="modal-actions">
          <button onClick={props.onClose}>{t("common.close")}</button>
          <Show when={statements() && statements()!.some(isExecutable) && !applied()}>
            <button class="primary" disabled={busy()} onClick={apply}>
              {busy() ? t("ssync.applying") : t("ssync.apply")}
            </button>
          </Show>
        </div>
    </Panel>
  );
}
