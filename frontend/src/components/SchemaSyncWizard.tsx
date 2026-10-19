import { For, Show, createSignal, onCleanup } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { Panel } from "./Panel";
import { ConfirmDialog } from "./ConfirmDialog";
import { schemaTree, schemaDescribe, schemaDdl } from "../utils/schema";
import {
  diffSchemas,
  diffEmpty,
  diffItems,
  filterDiff,
  generateMigration,
  isExecutable,
  losesData,
  scriptText,
  type DiffItem,
  type DiffKind,
  type CompareScope,
  type MigrationScript,
  type ScriptIssue,
} from "../utils/schemaDiff";
import { runStatements, type StepStatus, type StepsOutcome } from "../utils/statementRun";
import { copyText } from "../utils/rowCopy";
import { formatDuration } from "../utils/duration";
import { RunProgress } from "./RunProgress";
import { Icon } from "./icons";
import { readSnapshot, NotATableListError, type SnapshotSource } from "../utils/schemaCatalog";
import { openSaved, closeConnection } from "../utils/conn";
import { runQuery, drainQuery, QueryError } from "../utils/query";
import { txBegin, txCommit, txRollback } from "../utils/edit";
import { saveText, sqlFileName } from "../utils/download";
import type { Connection } from "../utils/connections";
import { t } from "../utils/i18n";
import { Dropdown } from "./Dropdown";
import { isReadOnlyTarget, targetOptions } from "../utils/wizard";
import { Wizard, WizardField } from "./Wizard";
import { countText, isDestructiveSql } from "../utils/confirmText";

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
  /** «Qué comparar»: the groups of objects the comparison looks at. */
  const [scope, setScope] = createSignal<CompareScope>({ structure: true, constraints: true, views: true });
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
  /** The apply step: every executable statement with its status, and how it ended. */
  const [run, setRun] = createSignal<{
    statements: string[];
    statuses: StepStatus[];
    startedAt: number;
    ms?: number;
    outcome?: StepsOutcome;
  } | null>(null);
  let runCtl: AbortController | null = null;
  // Data-losing statements the user opted into (indexes into executable()):
  // they start unchecked (audit A-30).
  const [optIn, setOptIn] = createSignal<ReadonlySet<number>>(new Set());

  // The target connection is opened for the compare and closed on unmount.
  let targetConnId: string | null = null;
  const closeTarget = () => {
    if (targetConnId) {
      void closeConnection(targetConnId);
      targetConnId = null;
    }
  };
  onCleanup(() => {
    runCtl?.abort();
    closeTarget();
  });

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
    setRun(null);
    try {
      closeTarget();
      targetConnId = await openSaved(def);
      const [src, tgt] = await Promise.all([
        readSnapshot(source(props.sourceConnId, props.sourceEngine, sourceDb(), sourceSchema())),
        readSnapshot(source(targetConnId, def.driver, targetDb(), targetSchema())),
      ]);
      const diff = filterDiff(diffSchemas(src, tgt), scope());
      const script = generateMigration(diff, {
        container: { db: targetDb() || undefined, schema: targetSchema() || undefined },
        sourceContainer: { db: sourceDb() || undefined, schema: sourceSchema() || undefined },
        dropTables: dropTables(),
      });
      const where = [targetDb(), targetSchema()].filter(Boolean).join(".");
      setOptIn(new Set<number>());
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
  /** Data-losing statements, with their index in executable(). */
  const losing = () => executable().flatMap((sql, i) => (losesData(sql) ? [{ sql, i }] : []));
  /** What Apply runs: everything, except data-losing statements left unchecked. */
  const chosen = () => executable().filter((sql, i) => !losesData(sql) || optIn().has(i));
  const toggle = (i: number, on: boolean) => {
    const next = new Set(optIn());
    if (on) next.add(i);
    else next.delete(i);
    setOptIn(next);
  };
  // The saved/opened script says where it is meant to run.
  const text = () => {
    const r = result();
    return r ? `-- Target: ${r.target}
${scriptText(r.script)}` : "";
  };

  // The apply step (R-15): every statement on screen with its status, one
  // transaction, stopped at the first failure or by Cancelar — both roll back.
  const apply = async () => {
    const sql = chosen();
    if (!targetConnId || sql.length === 0 || resultReadOnly()) return;
    const connId = targetConnId;
    const all = executable();
    const excluded = new Set(all.flatMap((s, i) => (losesData(s) && !optIn().has(i) ? [i] : [])));
    const ctl = new AbortController();
    runCtl = ctl;
    setError(null);
    setConfirming(false);
    const startedAt = Date.now();
    try {
      await withWriteConsent(connId, sql, async () => {
        setRun({
          statements: all,
          statuses: all.map((_, i) => (excluded.has(i) ? { state: "excluded" } : { state: "pending" })),
          startedAt,
        });
        await txBegin(connId);
        let outcome: StepsOutcome;
        try {
          outcome = await runStatements(
            all,
            async (stmt) => void (await runQuery(connId, stmt.replace(/;\s*$/, ""))),
            (i, status) => setRun((r) => r && { ...r, statuses: r.statuses.map((s, j) => (j === i ? status : s)) }),
            { excluded, signal: ctl.signal },
          );
        } catch (err) {
          await txRollback(connId).catch(() => {});
          throw err;
        }
        if (outcome.failedAt !== null || outcome.cancelled) await txRollback(connId).catch(() => {});
        else await txCommit(connId);
        setRun((r) => r && { ...r, outcome, ms: Date.now() - startedAt });
      });
    } catch (err) {
      setRun(null);
      setError(t("ssync.applyError", { reason: errMsg(err) }));
    } finally {
      if (runCtl === ctl) runCtl = null;
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

  // 0 what to compare, 1 the differences and the script, 2 the apply.
  const step = () => (run() ? 2 : result() ? 1 : 0);
  const applying = () => !!run() && !run()!.outcome;
  const statusText = (s: StepStatus) =>
    s.state === "done"
      ? t("ssync.st.done", { time: formatDuration(s.ms) })
      : s.state === "failed"
        ? t("ssync.st.failed", { message: s.message })
        : t(`ssync.st.${s.state}`);
  /** The apply log, for «Copiar registro»: one line per statement. */
  const runLog = () => {
    const r = run();
    return r ? r.statements.map((sql, i) => `${i + 1}\t${statusText(r.statuses[i])}\t${sql}`).join("\n") : "";
  };
  const outcomeText = () => {
    const r = run();
    const o = r?.outcome;
    if (!r || !o) return "";
    const time = formatDuration(r.ms ?? 0);
    if (o.cancelled) return t("ssync.outcome.cancelled", { target: targetName() });
    if (o.failedAt !== null) return t("ssync.outcome.failed", { n: o.failedAt + 1, target: targetName() });
    return countText("ssync.outcome.done", o.done, { target: targetName(), time });
  };
  const setScopeKey = (key: keyof CompareScope, on: boolean) => setScope((s) => ({ ...s, [key]: on }));
  const targetName = () => props.connections.find((c) => c.id === result()?.defId)?.name ?? "";
  // A read-only target gets the script, never an apply button (audit P1).
  const readOnly = () => isReadOnlyTarget(props.connections.find((c) => c.id === targetDefId()));
  const resultReadOnly = () => isReadOnlyTarget(props.connections.find((c) => c.id === result()?.defId));
  // A script that drops something is applied with the red button (R-15).
  const destructive = () => chosen().some(isDestructiveSql);

  return (
    <Panel wide onClose={props.onClose} dirty={busy() || applying() || (!!result() && !run())}>
      <Wizard
        title={t("ssync.title")}
        subtitle={t("ssync.subtitle")}
        steps={[t("ssync.step.compare"), t("ssync.step.review"), t("ssync.step.apply")]}
        step={step()}
        error={confirming() ? null : error()}
        busy={busy()}
        busyLabel={step() === 0 ? t("ssync.comparing") : t("ssync.applying")}
        onBack={step() === 1 ? () => setResult(null) : undefined}
        primary={
          step() === 0
            ? { label: t("ssync.compare"), onClick: () => void compare(), disabled: !targetDefId() }
            : step() === 1 && chosen().length > 0 && !resultReadOnly()
              ? {
                  label: countText("ssync.applyN", chosen().length, { target: targetName() }),
                  onClick: () => setConfirming(true),
                  danger: destructive(),
                }
              : undefined
        }
        cancelLabel={applying() ? t("ssync.cancelRun") : step() === 0 ? undefined : t("common.close")}
        onCancel={applying() ? () => runCtl?.abort() : props.onClose}
        helpers={
          <>
          <Show when={step() === 2 && run()?.outcome}>
            <button type="button" class="btn" onClick={() => copyText(runLog())}>
              {t("ssync.copyLog")}
            </button>
            <button type="button" class="btn" onClick={() => void compare()}>
              {t("ssync.compareAgain")}
            </button>
          </Show>
          <Show when={step() === 1 && result()!.script.statements.length > 0}>
            <button type="button" class="btn" onClick={() => props.onOpenSql(text(), result()!.defId)}>
              {t("ssync.openInEditor")}
            </button>
            <button
              type="button"
              class="btn"
              onClick={() => void saveText(sqlFileName("migration"), text(), "application/sql")}
            >
              {t("ssync.saveSql")}
            </button>
          </Show>
          </>
        }
      >
        <Show when={step() === 0}>
          <h3>{t("ssync.sourceHeading")}</h3>
          <div class="wiz-form">
            <WizardField label={t("wiz.db")} help={t("ssync.sourceHelp")}>
              <input
                type="text"
                value={sourceDb()}
                placeholder={t("ssync.dbDefault")}
                onInput={(e) => setSourceDb(e.currentTarget.value)}
              />
            </WizardField>
            <WizardField label={t("ssync.schema")}>
              <input
                type="text"
                value={sourceSchema()}
                placeholder={t("ssync.dbDefault")}
                onInput={(e) => setSourceSchema(e.currentTarget.value)}
              />
            </WizardField>
          </div>
          <h3>{t("ssync.targetHeading")}</h3>
          <div class="wiz-form">
            <WizardField label={t("ssync.target")} help={t("ssync.targetHelp")}>
              <Dropdown
                value={targetDefId()}
                options={targetOptions(props.connections)}
                onChange={(v) => setTargetDefId(v)}
              />
            </WizardField>
            <WizardField label={t("wiz.db")}>
              <input
                type="text"
                value={targetDb()}
                placeholder={t("ssync.dbDefault")}
                onInput={(e) => setTargetDb(e.currentTarget.value)}
              />
            </WizardField>
            <WizardField label={t("ssync.schema")}>
              <input
                type="text"
                value={targetSchema()}
                placeholder={t("ssync.dbDefault")}
                onInput={(e) => setTargetSchema(e.currentTarget.value)}
              />
            </WizardField>
            <Show when={readOnly()}>
              <p class="help" role="note">
                {t("wiz.readOnlyScript", {
                  name: props.connections.find((c) => c.id === targetDefId())?.name ?? "",
                })}
              </p>
            </Show>
          </div>
          <h3>{t("ssync.whatHeading")}</h3>
          <div class="wiz-form">
            <div class="wiz-row" role="group" aria-label={t("ssync.objects")}>
              <span class="wiz-label">{t("ssync.objects")}</span>
              <span class="wiz-ctl wiz-radios">
                <For each={["structure", "constraints", "views"] as (keyof CompareScope)[]}>
                  {(key) => (
                    <label class="import-check">
                      <input
                        type="checkbox"
                        checked={scope()[key]}
                        onChange={(e) => setScopeKey(key, e.currentTarget.checked)}
                      />
                      {t(`ssync.scope.${key}`)}
                    </label>
                  )}
                </For>
              </span>
            </div>
            <div class="wiz-row">
              <span class="wiz-label">{t("ssync.extraTables")}</span>
              <label class="wiz-ctl import-check">
                <input
                  type="checkbox"
                  checked={dropTables()}
                  onChange={(e) => setDropTables(e.currentTarget.checked)}
                />
                {t("ssync.dropTables")}
              </label>
            </div>
          </div>
        </Show>

        <Show when={step() === 1 && result()}>
          {(r) => {
            const unsupported = () => r().script.issues.filter((i) => i.kind === "unsupported");
            const notes = () => r().script.issues.filter((i) => i.kind === "note");
            return (
              <>
                <p class="wiz-sub">{t("ssync.direction", { target: r().target })}</p>
                <Show when={resultReadOnly()}>
                  <p class="help" role="note">
                    {t("wiz.readOnlyScript", { name: targetName() })}
                  </p>
                </Show>
                <h3>{t("ssync.differences", { n: r().items.length })}</h3>
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
                  <h3>{t("ssync.unsupported", { n: unsupported().length })}</h3>
                  <ul class="import-errors" role="alert">
                    <For each={unsupported()}>{(i) => <li>{issueText(i)}</li>}</For>
                  </ul>
                </Show>

                <Show when={notes().length > 0}>
                  <h3>{t("ssync.notes")}</h3>
                  <ul class="ssync-notes">
                    <For each={notes()}>{(i) => <li>{issueText(i)}</li>}</For>
                  </ul>
                </Show>

                <Show when={r().script.statements.length > 0}>
                  <div class="colmap-head">
                    <h3>{t("ssync.migrationSql", { n: executable().length })}</h3>
                    <span class="help">
                      {t("ssync.marked", { n: chosen().length, total: executable().length })}
                    </span>
                    <span class="toolbar-spacer" />
                    <button type="button" class="btn" onClick={() => copyText(text())}>
                      <Icon name="copy" size={14} />
                      {t("ssync.copyScript")}
                    </button>
                  </div>
                  <pre class="ddl-text preview-sql ssync-script" aria-label={t("ssync.script")}>
                    {text()}
                  </pre>
                </Show>

                <Show when={losing().length > 0}>
                  <section class="ssync-losing" aria-labelledby="ssync-losing-h">
                    <h3 id="ssync-losing-h">{t("ssync.losingHeading", { n: losing().length })}</h3>
                    <p class="field-error">{t("ssync.losingHelp")}</p>
                    <For each={losing()}>
                      {(s) => (
                        <label class="import-check">
                          <input
                            type="checkbox"
                            checked={optIn().has(s.i)}
                            onChange={(e) => toggle(s.i, e.currentTarget.checked)}
                          />
                          <code>{s.sql}</code>
                        </label>
                      )}
                    </For>
                  </section>
                </Show>
              </>
            );
          }}
        </Show>

        <Show when={run()}>
          {(r) => (
            <>
              <Show
                when={r().outcome}
                fallback={
                  <RunProgress
                    title={t("ssync.applyingIn", { target: targetName() })}
                    done={r().statuses.filter((s) => s.state === "done").length}
                    total={r().statuses.filter((s) => s.state !== "excluded").length}
                    unit="statements"
                    startedAt={r().startedAt}
                    note={t("ssync.cancelNote", { target: targetName() })}
                  />
                }
              >
                <p role="status" class={r().outcome!.failedAt !== null ? "field-error" : "import-applied"}>
                  {outcomeText()}
                </p>
              </Show>
              <h3>{t("ssync.statements")}</h3>
              <ol class="stmt-list">
                <For each={r().statements}>
                  {(sql, i) => (
                    <li class={`stmt is-${r().statuses[i()].state}`}>
                      <span class="stmt-num">{i() + 1}</span>
                      <code class="stmt-sql">{sql}</code>
                      <span class="stmt-status">{statusText(r().statuses[i()])}</span>
                    </li>
                  )}
                </For>
              </ol>
            </>
          )}
        </Show>
      </Wizard>

      <Show when={confirming()}>
        <ConfirmDialog
          title={t("ssync.confirmTitle", { target: targetName() })}
          message={t("ssync.confirmMessage", { n: chosen().length })}
          sql={chosen().join("\n")}
          confirmLabel={countText("ssync.applyN", chosen().length, { target: targetName() })}
          busy={busy()}
          error={error()}
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(false)}
        />
      </Show>
    </Panel>
  );
}
