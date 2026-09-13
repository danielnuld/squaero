import { For, Show, createEffect, createSignal } from "solid-js";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import { errorText } from "../utils/errors";
import { drainQuery, runQuery } from "../utils/query";
import { parseTreeRows, qualifiedName, schemaDdl, schemaTree, type TreeRow } from "../utils/schema";
import { dumpChunks, restoreStatements, runRestore, type DumpObject } from "../utils/backup";
import { fileNameFor } from "../utils/exporters";
import { pickSaveTarget } from "../utils/download";

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

  const backup = async () => {
    const db = props.db;
    if (!db) return;
    const sch = schema() || undefined;
    // The dialog first, while the click still counts as a user gesture.
    const target = await pickSaveTarget(fileNameFor(sch ? `${db}.${sch}` : db, "sql"), "application/sql");
    if (!target) return;
    const connId = props.connId;
    const list = chosen();
    let current = "";
    setBusy(true);
    setStatus(null);
    try {
      const writer = await target.open();
      await writer.write(`-- Squaero backup of ${sch ? `${db}.${sch}` : db}, ${new Date().toISOString()}\n`);
      const src = {
        ddl: async (name: string) => {
          const ddl = await schemaDdl(connId, name, db, sch);
          if (!ddl.trim()) throw new Error(t("bk.noDdl"));
          return ddl;
        },
        rows: (name: string) =>
          drainQuery(connId, `SELECT * FROM ${qualifiedName({ db, schema: sch, name }, props.engine)}`, PAGE),
      };
      const onObject = (name: string) => {
        current = name;
        setStatus({ text: t("bk.dumping", { name }) });
      };
      for await (const piece of dumpChunks(src, list, props.engine, { structure: structure(), data: data() }, onObject)) {
        await writer.write(piece);
      }
      // Only a finished dump is closed, and only a closed file reaches the disk:
      // a failure above leaves no half-written backup behind.
      await writer.close();
      setStatus({ text: t("bk.dumped", { n: list.length }) });
    } catch (err) {
      setStatus({ text: t("bk.dumpFailed", { name: current, reason: errorText(err) }), error: true });
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
      const report = await runRestore(
        s.stmts,
        (sql) => runQuery(connId, sql),
        (done) => setStatus({ text: t("bk.restoring", { done, total }) }),
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

  return (
    <Panel title={t("tool.backup.tab")}>
      <Show when={status()}>
        <div class={status()!.error ? "grid-error" : "import-subtitle"} role={status()!.error ? "alert" : "status"}>
          {status()!.text}
        </div>
      </Show>

      <h2>{t("bk.dumpHeading")}</h2>
      <Show when={props.db} fallback={<p class="import-subtitle">{t("bk.noDb")}</p>}>
        <div class="import-field">
          <span>{t("bk.db", { db: props.db! })}</span>{" "}
          <Show when={schemas().length > 0}>
            <label>
              {t("bk.schema")}{" "}
              <select value={schema()} onChange={(e) => setSchema(e.currentTarget.value)}>
                <option value="" />
                <For each={schemas()}>{(s) => <option value={s}>{s}</option>}</For>
              </select>
            </label>{" "}
          </Show>
          <label>
            <input type="checkbox" checked={structure()} onChange={(e) => setStructure(e.currentTarget.checked)} />{" "}
            {t("bk.structure")}
          </label>{" "}
          <label>
            <input type="checkbox" checked={data()} onChange={(e) => setData(e.currentTarget.checked)} />{" "}
            {t("bk.data")}
          </label>
        </div>
        <Show when={objects().length > 0}>
          <div class="import-subtitle">
            {t("bk.objects", { n: chosen().length })}{" "}
            <button class="edit-btn" onClick={() => pickAll(true)}>{t("bk.selectAll")}</button>{" "}
            <button class="edit-btn" onClick={() => pickAll(false)}>{t("bk.selectNone")}</button>
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
        <div class="modal-actions">
          <button
            class="primary"
            disabled={busy() || chosen().length === 0 || (!structure() && !data())}
            onClick={backup}
          >
            {t("bk.dump")}
          </button>
        </div>
      </Show>

      <h2>{t("bk.restoreHeading")}</h2>
      <p class="import-subtitle">{t("bk.restoreHint")}</p>
      <div class="import-field">
        <label>
          {t("bk.filePick")} <input type="file" accept=".sql,text/plain,application/sql" onChange={onFile} />
        </label>
      </div>
      <Show when={script()}>
        <p class="import-subtitle">{t("bk.fileStatements", { name: script()!.name, n: script()!.stmts.length })}</p>
        <div class="modal-actions">
          <button class="primary" disabled={busy() || !props.connId} onClick={restore}>
            {t("bk.restore")}
          </button>
        </div>
      </Show>
    </Panel>
  );
}
