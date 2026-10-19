import { Show, createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { withWriteConsent } from "../utils/transport";
import { Panel } from "./Panel";
import { drainQuery, QueryError, type ResultSet } from "../utils/query";
import { qualifiedName } from "../utils/schema";
import { openSaved, closeConnection } from "../utils/conn";
import { runPlanItem, txBegin, txCommit, txRollback, type EditTarget } from "../utils/edit";
import { diffData, dataDiffCounts, diffToPlan, pickOps, DEFAULT_SYNC_OPS, type SyncOps } from "../utils/dataDiff";
import { isReadOnlyTarget, targetOptions } from "../utils/wizard";
import { saveText, sqlFileName } from "../utils/download";
import type { Connection } from "../utils/connections";
import { t } from "../utils/i18n";
import type { PlanItem } from "../utils/editSession";
import { Dropdown } from "./Dropdown";
import { ConfirmDialog } from "./ConfirmDialog";
import { Wizard, WizardField } from "./Wizard";
import { countText } from "../utils/confirmText";
import { diffRows, equalCount, type DiffRow } from "../utils/dataDiffRows";
import { TablePreview } from "./TablePreview";
import { RunProgress } from "./RunProgress";
import { copyText } from "../utils/rowCopy";
import { Icon } from "./icons";

// Rows per page while reading each whole table.
const PAGE = 5000;

/**
 * Data diff / sync wizard (#35). Reads the WHOLE table on both sides — the
 * source from its own saved connection, the target from the chosen one — page by
 * page with progress and Cancel, compares by primary key, and derives the
 * INSERT/UPDATE/DELETE that make the target match the source. Comparing only the
 * rows on screen would DELETE real target rows past the page (issue #761), so it
 * never does. The SQL is previewed; applying asks first, naming the target and
 * the count per kind, then runs it on the target in a transaction (row.* path).
 *
 * ponytail: both tables are held in memory while diffing; a keyset walk over
 * both sides ordered by PK would bound that if huge tables become the norm.
 */
export function DataDiffWizard(props: {
  /** The saved connection the source table belongs to. */
  sourceDefId?: string;
  source: { table: string; db?: string; schema?: string };
  pk: string[];
  connections: Connection[];
  onClose: () => void;
}) {
  const [targetDefId, setTargetDefId] = createSignal(props.connections[0]?.id ?? "");
  const [targetDb, setTargetDb] = createSignal(props.source.db ?? "");
  const [plan, setPlan] = createSignal<PlanItem[] | null>(null);
  // Which kinds of operation to generate: DELETE off unless ticked (audit P1).
  const [ops, setOps] = createStore<SyncOps>({ ...DEFAULT_SYNC_OPS });
  const [counts, setCounts] = createSignal({ inserts: 0, updates: 0, deletes: 0, source: 0, target: 0 });
  const [preview, setPreview] = createSignal<string[]>([]);
  /** The review grid: one line per change, and the source rows left as they are. */
  const [changes, setChanges] = createSignal<DiffRow[]>([]);
  const [equal, setEqual] = createSignal(0);
  /** The apply in flight: how many operations are done, for the progress view. */
  const [applying, setApplying] = createSignal<{ startedAt: number; done: number } | null>(null);
  let applyCtl: AbortController | null = null;
  const [busy, setBusy] = createSignal(false);
  const [progress, setProgress] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [applied, setApplied] = createSignal<string | null>(null);
  const [confirming, setConfirming] = createSignal(false);
  const [confirmError, setConfirmError] = createSignal<string | null>(null);
  // What the plan was computed against, frozen: the confirmation names it and
  // apply writes to it, even if the target fields are edited afterwards.
  const [planTarget, setPlanTarget] = createSignal<{ name: string; ref: string; target: EditTarget }>({
    name: "",
    ref: "",
    target: { table: props.source.table },
  });

  let targetConnId: string | null = null;
  let reading: AbortController | null = null;
  const closeTarget = () => {
    if (targetConnId) {
      void closeConnection(targetConnId);
      targetConnId = null;
    }
  };
  onCleanup(() => {
    reading?.abort();
    applyCtl?.abort();
    closeTarget();
  });

  const errMsg = (e: unknown) => (e instanceof QueryError ? e.message : String(e));
  const target = () => ({
    table: props.source.table,
    db: targetDb() || undefined,
    schema: props.source.schema,
  });
  const defOf = (id?: string) => props.connections.find((c) => c.id === id);
  // A read-only target gets the script, never an apply button (audit P1).
  const readOnly = () => isReadOnlyTarget(defOf(targetDefId()));
  const refOf = (engine: string, db?: string) =>
    qualifiedName({ db, schema: props.source.schema, name: props.source.table }, engine);
  const selectAll = (engine: string, db?: string) => `SELECT * FROM ${refOf(engine, db)}`;

  const compare = async () => {
    const def = defOf(targetDefId());
    const srcDef = defOf(props.sourceDefId);
    if (!def) {
      setError(t("ssync.pickTarget"));
      return;
    }
    if (!srcDef) {
      setError(t("ddiff.noSource"));
      return;
    }
    const ctl = new AbortController();
    reading = ctl;
    setBusy(true);
    setError(null);
    setPlan(null);
    setApplied(null);
    let sourceConnId: string | null = null;
    try {
      closeTarget();
      // Its own session: the grid's tab keeps its cursor on the workspace one.
      sourceConnId = await openSaved(srcDef);
      const src = await drainQuery(
        sourceConnId,
        selectAll(srcDef.driver, props.source.db),
        PAGE,
        (n) => setProgress(countText("ddiff.readingSource", n)),
        ctl.signal,
      );
      targetConnId = await openSaved(def);
      const tgt = await drainQuery(
        targetConnId,
        selectAll(def.driver, targetDb() || undefined),
        PAGE,
        (n) => setProgress(countText("ddiff.readingTarget", n)),
        ctl.signal,
      );
      const full = diffData(src, tgt, props.pk);
      const diff = pickOps(full, { ...ops });
      const types = Object.fromEntries(src.columns.map((c) => [c.name, c.type]));
      const items = diffToPlan(diff, types);
      // Gather the exact SQL for each op (preview) on the target.
      setProgress(t("ddiff.preparing"));
      const sqls: string[] = [];
      for (const item of items) {
        ctl.signal.throwIfAborted();
        const r = await runPlanItem(targetConnId, target(), item, true);
        sqls.push(r.sql);
      }
      setPreview(sqls);
      setChanges(diffRows(diff, tgt, props.pk, src.columns.map((c) => c.name)));
      // Equal means equal in the whole comparison, not only among the ticked kinds.
      setEqual(equalCount(src.rows.length, full));
      setCounts({ ...dataDiffCounts(diff), source: src.rows.length, target: tgt.rows.length });
      setPlanTarget({ name: def.name, ref: refOf(def.driver, targetDb() || undefined), target: target() });
      setPlan(items);
    } catch (err) {
      setError(ctl.signal.aborted ? t("ddiff.cancelled") : errMsg(err));
    } finally {
      if (sourceConnId) void closeConnection(sourceConnId);
      if (reading === ctl) reading = null;
      setProgress(null);
      setBusy(false);
    }
  };

  const apply = async () => {
    const items = plan();
    // A read-only target only gets the script (audit P1).
    if (!items || items.length === 0 || !targetConnId || readOnly()) return;
    const connId = targetConnId;
    const ctl = new AbortController();
    applyCtl = ctl;
    setConfirmError(null);
    setError(null);
    try {
      await withWriteConsent(connId, preview(), async () => {
        setConfirming(false);
        setApplying({ startedAt: Date.now(), done: 0 });
        await txBegin(connId);
        try {
          for (const [i, item] of items.entries()) {
            ctl.signal.throwIfAborted();
            await runPlanItem(connId, planTarget().target, item, false);
            setApplying((a) => a && { ...a, done: i + 1 });
          }
          await txCommit(connId);
          setApplied(countText("ddiff.appliedN", items.length, { target: planTarget().name }));
          setPlan(null);
        } catch (err) {
          await txRollback(connId).catch(() => {});
          throw err;
        }
      });
    } catch (err) {
      setError(ctl.signal.aborted ? t("ddiff.applyCancelled") : t("ssync.applyError", { reason: errMsg(err) }));
    } finally {
      if (applyCtl === ctl) applyCtl = null;
      setApplying(null);
    }
  };

  /** The change lines as the shared grid's result: operation, key, column, now → then. */
  const changesResult = (): ResultSet => ({
    columns: [
      { name: t("ddiff.col.op"), type: "text" },
      ...props.pk.map((name) => ({ name, type: "text" })),
      { name: t("ddiff.col.column"), type: "text" },
      { name: t("ddiff.col.from"), type: "text" },
      { name: t("ddiff.col.to"), type: "text" },
    ],
    rows: changes().map((r) => [
      r.op,
      ...r.key,
      r.column ?? t(r.op === "INSERT" ? "ddiff.newRow" : "ddiff.deletedRow"),
      // A whole row has no «before» (insert) or «after» (delete): said, not NULL.
      r.op === "INSERT" ? t("ddiff.absent") : r.from,
      r.op === "DELETE" ? t("ddiff.removed") : r.to,
    ]),
    truncated: false,
    rowsAffected: 0,
  });

  // 0 what to compare, 1 the operations and their SQL, 2 applying / applied.
  const step = () => (applied() || applying() ? 2 : plan() ? 1 : 0);

  return (
    <Panel wide onClose={props.onClose} dirty={busy() || !!applying() || (!!plan() && !applied())}>
      <Wizard
        title={t("ddiff.title", { name: props.source.table })}
        subtitle={t("ddiff.subtitle")}
        steps={[t("ssync.step.compare"), t("ssync.step.review"), t("ssync.step.apply")]}
        step={step()}
        error={error()}
        busy={busy()}
        busyLabel={step() === 0 ? t("ssync.comparing") : t("ssync.applying")}
        onBack={step() === 1 ? () => setPlan(null) : undefined}
        primary={
          step() === 0
            ? { label: t("ssync.compare"), onClick: () => void compare(), disabled: !targetDefId() }
            : step() === 1 && plan()!.length > 0 && !readOnly()
              ? {
                  label: countText("ddiff.applyN", plan()!.length, { target: planTarget().name }),
                  onClick: () => {
                    setConfirmError(null);
                    setConfirming(true);
                  },
                  // Deleting target rows is what loses data (#761).
                  danger: counts().deletes > 0,
                }
              : undefined
        }
        cancelLabel={applying() ? t("ddiff.cancelRun") : step() === 0 ? undefined : t("common.close")}
        onCancel={applying() ? () => applyCtl?.abort() : props.onClose}
        helpers={
          <Show when={step() === 1 && preview().length > 0}>
            <button
              type="button"
              class="btn"
              onClick={() => void saveText(sqlFileName("data-sync"), `${preview().join(";\n")};\n`, "application/sql")}
            >
              {t("ssync.saveSql")}
            </button>
          </Show>
        }
      >
        <Show when={step() === 0}>
          <p class="help">
            {t("ddiff.scope")} {t("ddiff.typed")}
          </p>
          <div class="wiz-form">
            <WizardField label={t("ssync.target")} help={t("ddiff.targetHelp")}>
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
            <div class="wiz-row">
              <span class="wiz-label">{t("ddiff.ops")}</span>
              <span class="wiz-ctl">
                <label class="import-check">
                  <input type="checkbox" checked={ops.insert} onChange={(e) => setOps("insert", e.currentTarget.checked)} />
                  {t("ddiff.opInsert")}
                </label>
                <label class="import-check">
                  <input type="checkbox" checked={ops.update} onChange={(e) => setOps("update", e.currentTarget.checked)} />
                  {t("ddiff.opUpdate")}
                </label>
                <label class="import-check">
                  <input type="checkbox" checked={ops.delete} onChange={(e) => setOps("delete", e.currentTarget.checked)} />
                  {t("ddiff.opDelete")}
                </label>
              </span>
              <p class="help wiz-help">{t("ddiff.opsHelp")}</p>
            </div>
          </div>
          <Show when={readOnly()}>
            <p class="help" role="note">
              {t("wiz.readOnlyScript", { name: defOf(targetDefId())?.name ?? "" })}
            </p>
          </Show>
          <Show when={progress()}>
            <p class="import-subtitle" role="status">
              {progress()}{" "}
              <button type="button" class="btn" onClick={() => reading?.abort()}>
                {t("common.cancel")}
              </button>
            </p>
          </Show>
        </Show>

        <Show when={step() === 1 && plan()}>
          {(items) => (
            <>
              <h3>
                {t("ddiff.summary", {
                  source: counts().source,
                  target: counts().target,
                  ins: counts().inserts,
                  upd: counts().updates,
                  del: counts().deletes,
                })}
              </h3>
              <Show when={readOnly() && items().length > 0}>
                <p class="help" role="note">
                  {t("wiz.readOnlyScript", { name: planTarget().name })}
                </p>
              </Show>
              <p class="help">
                {t("ddiff.equalLine", {
                  pk: props.pk.join(", "),
                  source: counts().source,
                  target: counts().target,
                  equal: equal(),
                })}
              </p>
              <Show when={items().length > 0} fallback={<p>{t("ddiff.alreadyMatch")}</p>}>
                <TablePreview
                  title={countText("ddiff.changesN", changes().length)}
                  table={changesResult()}
                />
                <div class="colmap-head">
                  <h3>{countText("ddiff.sqlN", preview().length)}</h3>
                  <span class="help">{t("ddiff.sqlHelp")}</span>
                  <span class="toolbar-spacer" />
                  <button type="button" class="btn" onClick={() => copyText(preview().join(";\n"))}>
                    <Icon name="copy" size={14} />
                    {t("ssync.copyScript")}
                  </button>
                </div>
                <pre class="ddl-text preview-sql">{preview().join(";\n")}</pre>
              </Show>
            </>
          )}
        </Show>

        <Show when={applying()}>
          {(a) => (
            <RunProgress
              title={t("ddiff.applyingIn", { target: planTarget().name })}
              done={a().done}
              total={plan()?.length ?? null}
              unit="statements"
              startedAt={a().startedAt}
              note={t("ddiff.cancelNote", { target: planTarget().name })}
            />
          )}
        </Show>
        <Show when={applied()}>
          <p class="import-applied" role="status">
            {applied()}
          </p>
        </Show>
      </Wizard>

      <Show when={confirming() && plan()}>
        <ConfirmDialog
          title={countText("ddiff.confirmTitleN", plan()!.length, { target: planTarget().name })}
          message={t("ddiff.confirmMessage", {
            target: `${planTarget().name} › ${planTarget().ref}`,
            ins: counts().inserts,
            upd: counts().updates,
            del: counts().deletes,
          })}
          sql={preview().join(";\n")}
          confirmLabel={countText("ddiff.applyN", plan()!.length, { target: planTarget().name })}
          busy={busy()}
          error={confirmError()}
          onConfirm={apply}
          onCancel={() => setConfirming(false)}
        />
      </Show>
    </Panel>
  );
}
