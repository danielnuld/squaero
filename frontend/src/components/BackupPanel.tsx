import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import { errorText } from "../utils/errors";
import { drainQuery, runQuery } from "../utils/query";
import { parseTreeRows, qualifiedName, schemaDdl, schemaTree, type TreeRow } from "../utils/schema";
import {
  backupProgress,
  dumpChunks,
  objectCounts,
  restoreStatements,
  runRestore,
  type DumpObject,
} from "../utils/backup";
import { fileNameFor } from "../utils/exporters";
import { pickDirectory, pickSaveTarget, writeFilesToDirectory, type SaveTarget } from "../utils/download";
import { buildDumpZip, FOLDERS, planDdlDump, readDdl, type DdlJob, type SkippedObject } from "../utils/ddlDump";
import { objectFolders, objectLeaves, readDefinitionText } from "../utils/treeObjects";
import { definitionFor as routineDefinitionFor } from "../utils/routines";
import { definitionFor as objectDefinitionFor } from "../utils/triggers";
import { Dropdown } from "./Dropdown";
import { Wizard, WizardField, WizardSummary } from "./Wizard";
import { RunProgress } from "./RunProgress";
import { formatElapsed } from "../utils/duration";
import { ConfirmDialog } from "./ConfirmDialog";
import { countText, restoreConfirm } from "../utils/confirmText";

/** Rows per page while reading a table for the dump. */
const PAGE = 5000;

/**
 * Backup and restore (#143, phase 1). Backup writes the chosen tables and views of
 * the active database as a SQL file — CREATE statements and INSERTs — streamed to
 * disk as it is read. Restore runs a SQL file statement by statement against the
 * active connection and stops at the first failure. See utils/backup.ts.
 */
export function BackupPanel(props: {
  connId: string;
  /** The connection's name: the restore confirmation names its target. */
  connName?: string;
  engine: string;
  db: string | null;
  onCatalogChanged: () => void;
}) {
  const [schemas, setSchemas] = createSignal<string[]>([]);
  const [schema, setSchema] = createSignal("");
  const [objects, setObjects] = createSignal<DumpObject[]>([]);
  const [picked, setPicked] = createSignal<Record<string, boolean>>({});
  const [structure, setStructure] = createSignal(true);
  const [data, setData] = createSignal(true);
  const [script, setScript] = createSignal<{ name: string; stmts: string[] } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<{ text: string; error?: boolean } | null>(null);
  // What the last DDL dump could not include, and why (#673): never left out silently.
  const [skipped, setSkipped] = createSignal<string[]>([]);
  const [mode, setMode] = createSignal<"dump" | "ddl" | "restore">("dump");
  const [confirmRestore, setConfirmRestore] = createSignal(false);
  // The backup as a wizard (#692): 0 what, 1 where, 2 review and run.
  const [dumpStep, setDumpStep] = createSignal<0 | 1 | 2>(0);
  const [saveTarget, setSaveTarget] = createSignal<SaveTarget | null>(null);
  /** Rows per table, counted on the review step; null where it could not be. */
  const [counts, setCounts] = createSignal<Record<string, number | null>>({});
  const [run, setRun] = createSignal<{
    startedAt: number;
    read: Record<string, number>;
    seen: string[];
    current: string;
  } | null>(null);
  const [dumpResult, setDumpResult] = createSignal<{ ms: number; read: Record<string, number>; file: string } | null>(null);
  let dumpCtl: AbortController | null = null;
  onCleanup(() => dumpCtl?.abort());
  const canPickFolder = typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

  // The database's level is either its tables (MySQL, SQLite, Informix) or its
  // schemas (Postgres); with schemas, the tables come once one is chosen.
  let token = 0;
  createEffect(() => {
    const connId = props.connId;
    const db = props.db;
    const sch = schema();
    const my = ++token;
    setObjects([]);
    if (!connId || !db) return;
    schemaTree(connId, db, sch || undefined)
      .then((res) => {
        if (my !== token) return;
        const rows = parseTreeRows(res, "schema");
        const leaves = rows.filter((r): r is TreeRow & DumpObject => r.kind === "table" || r.kind === "view");
        if (leaves.length === 0 && !sch) {
          setSchemas(rows.map((r) => r.name));
          return;
        }
        setObjects(leaves.map((r) => ({ name: r.name, kind: r.kind })));
        setPicked(Object.fromEntries(leaves.map((r) => [r.name, true])));
      })
      .catch((err) => {
        if (my === token) setStatus({ text: errorText(err), error: true });
      });
  });

  const chosen = () => objects().filter((o) => picked()[o.name]);
  const pickAll = (on: boolean) =>
    setPicked(Object.fromEntries(objects().map((o) => [o.name, on])));

  const dumpLabel = () => {
    const sch = schema();
    return sch ? `${props.db}.${sch}` : (props.db ?? "");
  };
  const tableRef = (name: string) =>
    qualifiedName({ db: props.db ?? undefined, schema: schema() || undefined, name }, props.engine);

  // «Destino»: the save dialog, opened by the click so it counts as a user gesture.
  const chooseTarget = async () => {
    const target = await pickSaveTarget(fileNameFor(dumpLabel(), "sql"), "application/sql");
    if (target) setSaveTarget(target);
  };

  // «Revisar»: how many rows each table holds, for the summary and a progress
  // bar that moves by rows. Best-effort: a count that fails is just unknown.
  const toReview = async () => {
    setDumpStep(2);
    if (!data()) return;
    const out: Record<string, number | null> = {};
    for (const o of chosen().filter((x) => x.kind === "table")) {
      try {
        const r = await runQuery(props.connId, `SELECT COUNT(*) FROM ${tableRef(o.name)}`, 1);
        const n = Number(r.rows[0]?.[0]);
        out[o.name] = Number.isFinite(n) ? n : null;
      } catch {
        out[o.name] = null;
      }
    }
    setCounts(out);
  };

  const backup = async () => {
    const db = props.db;
    const target = saveTarget();
    if (!db || !target) return;
    const sch = schema() || undefined;
    const connId = props.connId;
    const list = chosen();
    const ctl = new AbortController();
    dumpCtl = ctl;
    const startedAt = Date.now();
    let current = "";
    setStatus(null);
    setRun({ startedAt, read: {}, seen: [], current: "" });
    let writer: Awaited<ReturnType<SaveTarget["open"]>> | null = null;
    try {
      writer = await target.open();
      await writer.write(`-- Squaero backup of ${sch ? `${db}.${sch}` : db}, ${new Date().toISOString()}\n`);
      const src = {
        ddl: async (name: string) => {
          const ddl = await schemaDdl(connId, name, db, sch);
          if (!ddl.trim()) throw new Error(t("bk.noDdl"));
          return ddl;
        },
        rows: (name: string) =>
          drainQuery(
            connId,
            `SELECT * FROM ${qualifiedName({ db, schema: sch, name }, props.engine)}`,
            PAGE,
            (n) => setRun((r) => r && { ...r, read: { ...r.read, [name]: n } }),
            ctl.signal,
          ),
      };
      const onObject = (name: string) => {
        current = name;
        setRun((r) => r && { ...r, current: name, seen: r.seen.includes(name) ? r.seen : [...r.seen, name] });
      };
      for await (const piece of dumpChunks(src, list, props.engine, { structure: structure(), data: data() }, onObject)) {
        ctl.signal.throwIfAborted();
        await writer.write(piece);
      }
      // Only a finished dump is closed, and only a closed file reaches the disk.
      await writer.close();
      setDumpResult({ ms: Date.now() - startedAt, read: run()?.read ?? {}, file: target.name });
    } catch (err) {
      // Cancelled or failed: what was written is discarded, never left half done.
      await writer?.abort().catch(() => {});
      setStatus({
        text: ctl.signal.aborted ? t("bk.cancelled") : t("bk.dumpFailed", { name: current, reason: errorText(err) }),
        error: true,
      });
    } finally {
      if (dumpCtl === ctl) dumpCtl = null;
      setRun(null);
    }
  };
  const resetDump = () => {
    setDumpResult(null);
    setSaveTarget(null);
    setStatus(null);
    setDumpStep(0);
  };
  const progress = () => {
    const r = run();
    return r
      ? backupProgress(chosen(), { structure: structure(), data: data() }, counts(), r.read, Math.max(0, r.seen.length - 1))
      : null;
  };
  const kindsText = () => {
    const c = objectCounts(chosen());
    return [countText("bk.tablesN", c.tables), ...(c.views ? [countText("bk.viewsN", c.views)] : [])].join(" · ");
  };
  const contentText = () =>
    structure() && data() ? t("bk.both") : structure() ? t("bk.structureOnly") : t("bk.dataOnly");
  const totalRows = () => {
    const values = chosen().filter((o) => o.kind === "table").map((o) => counts()[o.name]);
    return values.length > 0 && values.every((v) => typeof v === "number")
      ? (values as number[]).reduce((a, b) => a + b, 0)
      : null;
  };
  /** One object's line in the run and the result: its rows read of its rows. */
  const objectLine = (o: DumpObject, read: Record<string, number>) => {
    if (o.kind === "view") return t("bk.view");
    if (!data()) return t("bk.structureOnly");
    const n = read[o.name] ?? 0;
    const of = counts()[o.name];
    return typeof of === "number" ? t("bk.rowsOf", { n, total: of }) : countText("bk.rowsN", n);
  };

  // Every object of the database/schema, one job each: tables and views by
  // schema.ddl, routines/triggers/events by the catalog queries the tree uses.
  // A folder that cannot be listed becomes a note, not a silent gap.
  const ddlJobs = async (connId: string, db: string, sch: string | undefined) => {
    const jobs: DdlJob[] = objects().map((o) => ({
      kind: o.kind,
      name: o.name,
      read: () => schemaDdl(connId, o.name, db, sch),
    }));
    const notes: string[] = [];
    const folders = objectFolders(props.engine, db);
    if (folders.length === 0) notes.push(t("ddl.noRoutines"));
    for (const spec of folders) {
      try {
        const res = await runQuery(connId, spec.listSql);
        for (const leaf of objectLeaves(spec, res.columns.map((c) => c.name), res.rows)) {
          const query =
            spec.groupKind === "procedure" || spec.groupKind === "function"
              ? routineDefinitionFor(props.engine, {
                  name: leaf.name,
                  type: spec.groupKind === "function" ? "FUNCTION" : "PROCEDURE",
                  id: leaf.id,
                })
              : objectDefinitionFor(props.engine, spec.groupKind, { name: leaf.name, table: leaf.table, id: leaf.id });
          jobs.push({
            kind: spec.groupKind,
            name: leaf.name,
            read: async () => {
              if (leaf.def) return leaf.def;
              if (!query) throw new Error(t("bk.noDdl"));
              const r = await runQuery(connId, query.sql);
              return readDefinitionText(r.columns.map((c) => c.name), r.rows, query.column, query.concatRows);
            },
          });
        }
      } catch (err) {
        notes.push(t("ddl.listFailed", { what: FOLDERS[spec.groupKind], reason: errorText(err) }));
      }
    }
    return { jobs, notes };
  };

  const dumpDdl = async () => {
    const db = props.db;
    if (!db) return;
    const sch = schema() || undefined;
    const label = sch ? `${db}.${sch}` : db;
    // The dialog first, while the click still counts as a user gesture. Without
    // a folder picker, the same tree goes into one .zip.
    const dir = await pickDirectory();
    if (dir === null) return;
    const zip = dir ? null : await pickSaveTarget(fileNameFor(label, "zip"), "application/zip");
    if (!dir && !zip) return;
    const connId = props.connId;
    setBusy(true);
    setStatus(null);
    setSkipped([]);
    try {
      const { jobs, notes } = await ddlJobs(connId, db, sch);
      const total = jobs.length;
      const read = await readDdl(jobs, errorText, (done, name) =>
        setStatus({ text: t("ddl.reading", { name, done: done + 1, total }) }),
      );
      const plan = planDdlDump(read);
      if (dir) {
        await writeFilesToDirectory(dir, plan.files, (done) =>
          setStatus({ text: t("ddl.writing", { done, total: plan.files.length }) }),
        );
      } else {
        await zip!.write(new Blob([new Uint8Array(buildDumpZip(plan.files))], { type: "application/zip" }));
      }
      const why = (s: SkippedObject) => `${FOLDERS[s.kind]}/${s.name}: ${s.reason ?? t("bk.noDdl")}`;
      setSkipped([...notes, ...plan.skipped.map(why)]);
      setStatus({
        text: t("ddl.done", { n: plan.files.length, target: dir ? dir.name : fileNameFor(label, "zip") }) +
          (plan.skipped.length ? " " + t("ddl.skipped", { n: plan.skipped.length }) : ""),
        error: plan.skipped.length > 0,
      });
    } catch (err) {
      setStatus({ text: t("ddl.failed", { reason: errorText(err) }), error: true });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: Event & { currentTarget: HTMLInputElement }) => {
    const file = e.currentTarget.files?.[0];
    setScript(null);
    setStatus(null);
    if (!file) return;
    const stmts = restoreStatements(await file.text(), props.engine);
    if (stmts.length === 0) {
      setStatus({ text: t("bk.emptyFile"), error: true });
      return;
    }
    setScript({ name: file.name, stmts });
  };

  const restore = async () => {
    const s = script();
    if (!s) return;
    const connId = props.connId;
    const total = s.stmts.length;
    setBusy(true);
    setStatus({ text: t("bk.restoring", { done: 0, total }) });
    try {
      const report = await withWriteConsent(connId, s.stmts, () =>
        runRestore(
          s.stmts,
          (sql) => runQuery(connId, sql),
          (done) => setStatus({ text: t("bk.restoring", { done, total }) }),
        ),
      );
      setStatus(
        report.failed
          ? {
              text: t("bk.restoreFailed", {
                index: report.failed.index,
                total,
                reason: errorText(report.failed.error),
              }),
              error: true,
            }
          : { text: t("bk.restored", { n: report.ran }) },
      );
      if (report.ran > 0) props.onCatalogChanged();
    } finally {
      setBusy(false);
    }
  };

  // Restoring runs a whole file over the database: it asks first, naming the
  // file, the statements and where they go (audit A-10).
  const target = () => [props.connName, props.db].filter(Boolean).join(" › ");
  const askRestore = () => {
    if (script()) setConfirmRestore(true);
  };

  const primary = () => {
    if (mode() === "dump") {
      if (run() || dumpResult()) return undefined;
      if (dumpStep() === 0) {
        return {
          label: t("wiz.next"),
          onClick: () => setDumpStep(1),
          disabled: !props.db || chosen().length === 0 || (!structure() && !data()),
        };
      }
      if (dumpStep() === 1) {
        return { label: t("wiz.next"), onClick: () => void toReview(), disabled: !saveTarget() };
      }
      return { label: t("bk.dump"), onClick: () => void backup() };
    }
    if (mode() === "ddl") {
      return {
        label: canPickFolder ? t("ddl.dump") : t("ddl.dumpZip"),
        onClick: () => void dumpDdl(),
        disabled: !props.db || (schemas().length > 0 && !schema()),
      };
    }
    return {
      label: countText("confirm.restore.button", script()?.stmts.length ?? 0),
      onClick: askRestore,
      disabled: !script() || !props.connId,
      danger: true,
    };
  };

  const MODES = [
    ["dump", "bk.dumpHeading"],
    ["ddl", "ddl.heading"],
    ["restore", "bk.restoreHeading"],
  ] as const;

  return (
    <Panel title={t("tool.backup.tab")}>
      <Wizard
        title={t("tool.backup.tab")}
        subtitle={props.db ? t("bk.db", { db: target() }) : t("bk.noDb")}
        error={status()?.error ? status()!.text : null}
        busy={busy()}
        primary={primary()}
        steps={mode() === "dump" ? [t("bk.step.what"), t("bk.step.where"), t("bk.step.review")] : undefined}
        step={dumpResult() ? 3 : dumpStep()}
        onBack={mode() === "dump" && dumpStep() > 0 && !run() && !dumpResult() ? () => setDumpStep((s) => (s - 1) as 0 | 1) : undefined}
        cancelLabel={run() ? t("bk.cancelRun") : undefined}
        onCancel={run() ? () => dumpCtl?.abort() : undefined}
        helpers={
          <Show when={mode() === "dump" && dumpResult()}>
            <button type="button" class="btn" onClick={resetDump}>
              {t("bk.again")}
            </button>
          </Show>
        }
      >
        {/* Three jobs, one primary each (audit A-32): tabs, not three
            sections with a primary button apiece. */}
        <div class="seg" role="tablist" aria-label={t("tool.backup.tab")}>
          <For each={MODES}>
            {([id, label]) => (
              <button
                type="button"
                role="tab"
                class={mode() === id ? "seg-btn on" : "seg-btn"}
                aria-selected={mode() === id}
                disabled={!!run()}
                onClick={() => {
                  setMode(id);
                  setStatus(null);
                }}
              >
                {t(label)}
              </button>
            )}
          </For>
        </div>

        <Show when={status() && !status()!.error}>
          <p class="import-subtitle" role="status">
            {status()!.text}
          </p>
        </Show>

        <Show when={mode() === "dump" && props.db && dumpStep() === 0}>
          <div class="wiz-form">
            <Show when={schemas().length > 0}>
              <WizardField label={t("bk.schema")}>
                <Dropdown
                  value={schema()}
                  options={[{ value: "", label: "" }, ...schemas().map((s) => ({ value: s, label: s }))]}
                  onChange={(v) => setSchema(v)}
                />
              </WizardField>
            </Show>
            <div class="wiz-row">
              <span class="wiz-label">{t("bk.content")}</span>
              <span class="wiz-ctl wiz-radios">
                <label>
                  <input type="checkbox" checked={structure()} onChange={(e) => setStructure(e.currentTarget.checked)} />
                  {t("bk.structure")}
                </label>
                <label>
                  <input type="checkbox" checked={data()} onChange={(e) => setData(e.currentTarget.checked)} />
                  {t("bk.data")}
                </label>
              </span>
            </div>
          </div>
          <Show when={objects().length > 0}>
            <div class="colmap-head">
              <h3>{t("bk.objectsHeading")}</h3>
              <span class="help" role="status">
                {t("bk.picked", { n: chosen().length, total: objects().length })}
              </span>
              <span class="toolbar-spacer" />
              <button type="button" class="btn" onClick={() => pickAll(true)}>
                {t("bk.selectAll")}
              </button>
              <button type="button" class="btn" onClick={() => pickAll(false)}>
                {t("bk.selectNone")}
              </button>
            </div>
            <div class="import-mapping">
              <For each={objects()}>
                {(o) => (
                  <label class="map-row">
                    <input
                      type="checkbox"
                      checked={!!picked()[o.name]}
                      onChange={(e) => setPicked((p) => ({ ...p, [o.name]: e.currentTarget.checked }))}
                    />{" "}
                    {o.name}
                    <Show when={o.kind === "view"}> ({t("tree.views")})</Show>
                  </label>
                )}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={mode() === "dump" && props.db && dumpStep() === 1}>
          <div class="wiz-form">
            <WizardField label={t("bk.file")} help={t("bk.fileHelp")}>
              <span>{saveTarget()?.name ?? fileNameFor(dumpLabel(), "sql")}</span>
              <button type="button" class="btn" onClick={() => void chooseTarget()}>
                {t("bk.chooseFile")}
              </button>
            </WizardField>
          </div>
        </Show>

        <Show when={mode() === "dump" && props.db && dumpStep() === 2}>
          <Show when={!run() && !dumpResult()}>
            <h3>{t("bk.summary")}</h3>
            <div class="wiz-form">
              <WizardField label={t("bk.source")}>
                <span>{target()}</span>
              </WizardField>
              <WizardField label={t("bk.objectsLabel")}>
                <span>{kindsText()}</span>
              </WizardField>
              <WizardField label={t("bk.content")}>
                <span>{contentText()}</span>
              </WizardField>
              <Show when={data()}>
                <WizardField label={t("bk.rows")}>
                  <span>{totalRows() ?? t("bk.rowsUnknown")}</span>
                </WizardField>
              </Show>
              <WizardField label={t("bk.file")}>
                <span>{saveTarget()?.name}</span>
              </WizardField>
            </div>
            <p class="help">{t("bk.restoreNote")}</p>
          </Show>
          <Show when={run()}>
            {(r) => (
              <RunProgress
                title={t("bk.running", { db: dumpLabel(), file: saveTarget()?.name ?? "" })}
                done={progress()!.done}
                total={progress()!.total}
                unit={progress()!.unit}
                startedAt={r().startedAt}
                counts={r().current ? [{ label: t("bk.current", { name: r().current }) }] : []}
                note={t("bk.cancelNote")}
              />
            )}
          </Show>
          <Show when={dumpResult()}>
            {(res) => (
              <>
                <p role="status" class="import-applied">
                  {t("bk.savedTo", { file: res().file })}
                </p>
                <WizardSummary
                  stats={[
                    { value: chosen().length, label: t("bk.stat.objects") },
                    ...(data()
                      ? [{ value: Object.values(res().read).reduce((a, b) => a + b, 0), label: t("bk.stat.rows") }]
                      : []),
                    { value: formatElapsed(res().ms), label: t("imp.stat.time") },
                  ]}
                />
              </>
            )}
          </Show>
          <Show when={run() || dumpResult()}>
            <ul class="stmt-list">
              <For each={chosen()}>
                {(o) => (
                  <li class={run()?.current === o.name ? "stmt is-running" : "stmt"}>
                    <span class="stmt-num">{o.kind === "view" ? t("bk.view") : t("bk.table")}</span>
                    <code class="stmt-sql">{o.name}</code>
                    <span class="stmt-status">{objectLine(o, run()?.read ?? dumpResult()?.read ?? {})}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>

        <Show when={mode() === "ddl"}>
          <p class="help">{t("ddl.hint")}</p>
          <Show when={!canPickFolder}>
            <p class="help">{t("ddl.hintZip")}</p>
          </Show>
          <Show when={schemas().length > 0}>
            <div class="wiz-form">
              <WizardField label={t("bk.schema")}>
                <Dropdown
                  value={schema()}
                  options={[{ value: "", label: "" }, ...schemas().map((s) => ({ value: s, label: s }))]}
                  onChange={(v) => setSchema(v)}
                />
              </WizardField>
            </div>
          </Show>
          <Show when={skipped().length > 0}>
            <ul class="import-subtitle">
              <For each={skipped()}>{(line) => <li>{line}</li>}</For>
            </ul>
          </Show>
        </Show>

        <Show when={mode() === "restore"}>
          <p class="help">{t("bk.restoreHint")}</p>
          <div class="wiz-form">
            <WizardField
              label={t("bk.filePick")}
              help={script() ? t("bk.fileStatements", { name: script()!.name, n: script()!.stmts.length }) : undefined}
            >
              <input type="file" accept=".sql,text/plain,application/sql" onChange={onFile} />
            </WizardField>
          </div>
        </Show>
      </Wizard>

      <Show when={confirmRestore() && script()}>
        {(s) => (
          <ConfirmDialog
            title={restoreConfirm(s().name, s().stmts.length, target()).title}
            message={restoreConfirm(s().name, s().stmts.length, target()).message}
            confirmLabel={restoreConfirm(s().name, s().stmts.length, target()).confirm}
            onConfirm={() => {
              setConfirmRestore(false);
              void restore();
            }}
            onCancel={() => setConfirmRestore(false)}
          />
        )}
      </Show>
    </Panel>
  );
}
