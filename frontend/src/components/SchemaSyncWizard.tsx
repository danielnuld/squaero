import { For, Show, createSignal, onCleanup } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { Panel } from "./Panel";
import { ConfirmDialog } from "./ConfirmDialog";
import { schemaTree, schemaDescribe, schemaDdl } from "../utils/schema";
import {
  diffSchemas,
  diffEmpty,
  diffItems,
  generateMigration,
  isExecutable,
  scriptText,
  type DiffItem,
  type DiffKind,
  type MigrationScript,
  type ScriptIssue,
} from "../utils/schemaDiff";
import { readSnapshot, NotATableListError, type SnapshotSource } from "../utils/schemaCatalog";
import { openSaved, closeConnection } from "../utils/conn";
import { runQuery, drainQuery, QueryError } from "../utils/query";
import { txBegin, txCommit, txRollback } from "../utils/edit";
import { saveText, sqlFileName } from "../utils/download";
import type { Connection } from "../utils/connections";
import { t } from "../utils/i18n";

/** Display order of the difference categories. */
const KINDS: DiffKind[] = ["table", "column", "primaryKey", "unique", "index", "foreignKey", "check", "view"];
const SIGN = { added: "+", removed: "−", changed: "~" } as const;

/**
 * Schema diff / structure-sync wizard (#34, #672). Compares the SOURCE (the
 * active connection) against a chosen TARGET connection — tables, columns, keys,
 * constraints, indexes and views — and shows the categorized differences, what
 * the target engine cannot do, and the migration script that would make the
 * target match the source. The script is only shown: it can be opened in a query
 * tab bound to the target, saved as .sql, or applied — a separate step behind a
 * confirmation that shows exactly what will run.
 */
export function SchemaSyncWizard(props: {
  sourceConnId: string;
  sourceEngine: string;
  sourceDb?: string;
  sourceSchema?: string;
  connections: Connection[];
  /** Open the script in a new query tab bound to the given connection. */
  onOpenSql: (sql: string, connDefId: string) => void;
  onClose: () => void;
}) {
  const [sourceDb, setSourceDb] = createSignal(props.sourceDb ?? "");
  const [sourceSchema, setSourceSchema] = createSignal(props.sourceSchema ?? "");
  const [targetDefId, setTargetDefId] = createSignal(props.connections[0]?.id ?? "");
  const [targetDb, setTargetDb] = createSignal(props.sourceDb ?? "");
  const [targetSchema, setTargetSchema] = createSignal(props.sourceSchema ?? "");
  const [dropTables, setDropTables] = createSignal(false);
  const [result, setResult] = createSignal<{
    items: DiffItem[];
    empty: boolean;
    script: MigrationScript;
    defId: string;
    target: string;
  } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [confirming, setConfirming] = createSignal(false);
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

  const errMsg = (e: unknown) =>
    e instanceof NotATableListError
      ? t("ssync.needContainer")
      : e instanceof QueryError
        ? e.message
        : String(e);

  const source = (connId: string, engine: string, db: string, schema: string): SnapshotSource => {
    const d = db || undefined;
    const s = schema || undefined;
    return {
      engine,
      container: { db: d, schema: s },
      tree: () => schemaTree(connId, d, s),
      describe: (table) => schemaDescribe(connId, table, d, s),
      ddl: (view) => schemaDdl(connId, view, d, s),
      query: (sql) => drainQuery(connId, sql, 1000),
    };
  };

  const compare = async () => {
    const def = props.connections.find((c) => c.id === targetDefId());
    if (!def) {
      setError(t("ssync.pickTarget"));
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setApplied(null);
    try {
      closeTarget();
      targetConnId = await openSaved(def);
      const [src, tgt] = await Promise.all([
        readSnapshot(source(props.sourceConnId, props.sourceEngine, sourceDb(), sourceSchema())),
        readSnapshot(source(targetConnId, def.driver, targetDb(), targetSchema())),
      ]);
      const diff = diffSchemas(src, tgt);
      const script = generateMigration(diff, {
        container: { db: targetDb() || undefined, schema: targetSchema() || undefined },
        dropTables: dropTables(),
      });
      const where = [targetDb(), targetSchema()].filter(Boolean).join(".");
      setResult({
        items: diffItems(diff),
        empty: diffEmpty(diff),
        script,
        defId: def.id,
        target: `${def.name} (${def.driver}${where ? `, ${where}` : ""})`,
      });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const executable = () => result()?.script.statements.filter(isExecutable) ?? [];
  // The saved/opened script says where it is meant to run.
  const text = () => {
    const r = result();
    return r ? `-- Target: ${r.target}
${scriptText(r.script)}` : "";
  };

  const apply = async () => {
    const sql = executable();
    if (!targetConnId || sql.length === 0) return;
    const connId = targetConnId;
    setBusy(true);
    setError(null);
    try {
      await withWriteConsent(connId, sql, async () => {
        await txBegin(connId);
        try {
          for (const stmt of sql) {
            await runQuery(connId, stmt.replace(/;\s*$/, ""));
          }
          await txCommit(connId);
          setApplied(t("ssync.applied", { n: sql.length }));
          setConfirming(false);
        } catch (err) {
          await txRollback(connId).catch(() => {});
          throw err;
        }
      });
    } catch (err) {
      setError(t("ssync.applyError", { reason: errMsg(err) }));
    } finally {
      setBusy(false);
    }
  };

  const issueText = (i: ScriptIssue) =>
    i.code === "notCompared"
      ? t("ssync.issue.notCompared", {
          what: t(`ssync.cat.${i.object}`),
          side: t(i.side === "target" ? "ssync.sideTarget" : "ssync.sideSource"),
          reason: i.detail || t("ssync.noCatalog"),
        })
      : `${i.object}: ${t(`ssync.issue.${i.code}`)}${i.detail ? ` (${i.detail})` : ""}`;

  return (
    <Panel wide onClose={props.onClose}>
      <h2>{t("ssync.title")}</h2>

      <div class="import-field">
        <span class="import-subtitle">{t("ssync.source")}</span>{" "}
        <label>
          {t("ssync.db")}{" "}
          <input
            type="text"
            value={sourceDb()}
            placeholder={t("ssync.dbDefault")}
            onInput={(e) => setSourceDb(e.currentTarget.value)}
          />
        </label>{" "}
        <label>
          {t("ssync.schema")}{" "}
          <input
            type="text"
            value={sourceSchema()}
            placeholder={t("ssync.dbDefault")}
            onInput={(e) => setSourceSchema(e.currentTarget.value)}
          />
        </label>
      </div>

      <div class="import-field">
        <label>
          {t("ssync.target")}{" "}
          <select value={targetDefId()} onChange={(e) => setTargetDefId(e.currentTarget.value)}>
            <For each={props.connections}>{(c) => <option value={c.id}>{c.name}</option>}</For>
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
        <label>
          {t("ssync.schema")}{" "}
          <input
            type="text"
            value={targetSchema()}
            placeholder={t("ssync.dbDefault")}
            onInput={(e) => setTargetSchema(e.currentTarget.value)}
          />
        </label>
      </div>

      <div class="import-field">
        <label class="import-check">
          <input
            type="checkbox"
            checked={dropTables()}
            onChange={(e) => setDropTables(e.currentTarget.checked)}
          />
          {t("ssync.dropTables")}
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

      <Show when={result()}>
        {(r) => {
          const unsupported = () => r().script.issues.filter((i) => i.kind === "unsupported");
          const notes = () => r().script.issues.filter((i) => i.kind === "note");
          return (
            <>
              <div class="import-subtitle">{t("ssync.differences", { n: r().items.length })}</div>
              <Show when={!r().empty} fallback={<p>{t("ssync.alreadyMatch")}</p>}>
                <ul class="ssync-diff">
                  <For each={KINDS.filter((k) => r().items.some((i) => i.kind === k))}>
                    {(kind) => (
                      <li>
                        <strong>{t(`ssync.kind.${kind}`)}</strong>
                        <ul>
                          <For each={r().items.filter((i) => i.kind === kind)}>
                            {(i) => (
                              <li>
                                <code>
                                  {SIGN[i.change]} {i.name}
                                </code>
                                {i.detail ? ` — ${i.detail}` : ""}
                              </li>
                            )}
                          </For>
                        </ul>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <Show when={unsupported().length > 0}>
                <div class="import-subtitle">{t("ssync.unsupported", { n: unsupported().length })}</div>
                <ul class="import-errors" role="alert">
                  <For each={unsupported()}>{(i) => <li>{issueText(i)}</li>}</For>
                </ul>
              </Show>

              <Show when={notes().length > 0}>
                <div class="import-subtitle">{t("ssync.notes")}</div>
                <ul class="ssync-notes">
                  <For each={notes()}>{(i) => <li>{issueText(i)}</li>}</For>
                </ul>
              </Show>

              <Show when={r().script.statements.length > 0}>
                <div class="import-subtitle">
                  {t("ssync.migrationSql", { n: executable().length })}
                </div>
                <pre class="ddl-text preview-sql ssync-script" aria-label={t("ssync.script")}>
                  {text()}
                </pre>
              </Show>
            </>
          );
        }}
      </Show>

      <Show when={applied()}>
        <p class="import-applied">{applied()}</p>
      </Show>

      <div class="modal-actions">
        <button onClick={props.onClose}>{t("common.close")}</button>
        <Show when={result() && result()!.script.statements.length > 0}>
          <button onClick={() => props.onOpenSql(text(), result()!.defId)}>
            {t("ssync.openInEditor")}
          </button>
          <button onClick={() => void saveText(sqlFileName("migration"), text(), "application/sql")}>
            {t("ssync.saveSql")}
          </button>
        </Show>
        <Show when={executable().length > 0 && !applied()}>
          <button class="primary" disabled={busy()} onClick={() => setConfirming(true)}>
            {t("ssync.apply")}
          </button>
        </Show>
      </div>

      <Show when={confirming()}>
        <ConfirmDialog
          title={t("ssync.confirmTitle")}
          message={t("ssync.confirmMessage", { n: executable().length })}
          sql={executable().join("\n")}
          confirmLabel={busy() ? t("ssync.applying") : t("ssync.confirmApply")}
          busy={busy()}
          error={error()}
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(false)}
        />
      </Show>
    </Panel>
  );
}
