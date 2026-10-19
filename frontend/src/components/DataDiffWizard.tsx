import { Show, createSignal, onCleanup } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { Panel } from "./Panel";
import { drainQuery, QueryError } from "../utils/query";
import { qualifiedName } from "../utils/schema";
import { openSaved, closeConnection } from "../utils/conn";
import { runPlanItem, txBegin, txCommit, txRollback, type EditTarget } from "../utils/edit";
import { diffData, dataDiffCounts, diffToPlan } from "../utils/dataDiff";
import type { Connection } from "../utils/connections";
import { t } from "../utils/i18n";
import type { PlanItem } from "../utils/editSession";
import { Dropdown } from "./Dropdown";
import { ConfirmDialog } from "./ConfirmDialog";
import { Wizard, WizardField } from "./Wizard";
import { countText } from "../utils/confirmText";

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
  const [counts, setCounts] = createSignal({ inserts: 0, updates: 0, deletes: 0, source: 0, target: 0 });
  const [preview, setPreview] = createSignal<string[]>([]);
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
    closeTarget();
  });

  const errMsg = (e: unknown) => (e instanceof QueryError ? e.message : String(e));
  const target = () => ({
    table: props.source.table,
    db: targetDb() || undefined,
    schema: props.source.schema,
  });
  const defOf = (id?: string) => props.connections.find((c) => c.id === id);
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
        (n) => setProgress(t("ddiff.readingSource", { n })),
        ctl.signal,
      );
      targetConnId = await openSaved(def);
      const tgt = await drainQuery(
        targetConnId,
        selectAll(def.driver, targetDb() || undefined),
        PAGE,
        (n) => setProgress(t("ddiff.readingTarget", { n })),
        ctl.signal,
      );
      const diff = diffData(src, tgt, props.pk);
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
    if (!items || items.length === 0 || !targetConnId) return;
    const connId = targetConnId;
    setBusy(true);
    setConfirmError(null);
    try {
      await withWriteConsent(connId, preview(), async () => {
        await txBegin(connId);
        try {
          for (const item of items) {
            await runPlanItem(connId, planTarget().target, item, false);
          }
          await txCommit(connId);
          setApplied(t("ddiff.applied", { n: items.length }));
          setPlan(null);
          setConfirming(false);
        } catch (err) {
          await txRollback(connId).catch(() => {});
          throw err;
        }
      });
    } catch (err) {
      setConfirmError(t("ssync.applyError", { reason: errMsg(err) }));
    } finally {
      setBusy(false);
    }
  };

  // 0 what to compare, 1 the operations and their SQL, 2 applied.
  const step = () => (applied() ? 2 : plan() ? 1 : 0);

  return (
    <Panel wide onClose={props.onClose}>
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
            : step() === 1 && plan()!.length > 0
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
        cancelLabel={step() === 0 ? undefined : t("common.close")}
        onCancel={props.onClose}
      >
        <Show when={step() === 0}>
          <p class="help">{t("ddiff.scope")}</p>
          <div class="wiz-form">
            <WizardField label={t("ssync.target")} help={t("ddiff.targetHelp")}>
              <Dropdown
                value={targetDefId()}
                options={props.connections.map((c) => ({ value: c.id, label: c.name }))}
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
          </div>
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
              <Show when={items().length > 0} fallback={<p>{t("ddiff.alreadyMatch")}</p>}>
                <pre class="ddl-text preview-sql">{preview().join(";\n")}</pre>
              </Show>
            </>
          )}
        </Show>

        <Show when={applied()}>
          <p class="import-applied">{applied()}</p>
        </Show>
      </Wizard>

      <Show when={confirming() && plan()}>
        <ConfirmDialog
          title={t("ddiff.confirmTitle")}
          message={t("ddiff.confirmMessage", {
            target: `${planTarget().name} › ${planTarget().ref}`,
            ins: counts().inserts,
            upd: counts().updates,
            del: counts().deletes,
          })}
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
