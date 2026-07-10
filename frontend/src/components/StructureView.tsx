import { For, Show, createSignal, onMount } from "solid-js";
import { schemaDescribe, schemaDdl, qualifiedName } from "../utils/schema";
import { runQuery, type ResultSet } from "../utils/query";
import { txBegin, txCommit, txRollback } from "../utils/edit";
import { buildViewApply } from "../utils/viewEdit";
import { formatSql } from "../utils/sqlFormat";
import { errorText } from "../utils/errors";
import { Panel } from "./Panel";
import type { NodeKind } from "../utils/schema";

// Modal showing a table/view structure: the column list (schema.describe) and
// the engine's CREATE statement (schema.ddl) with a copy button (#20/#21). For
// a view it also allows editing the definition and applying it (issue #108):
// CREATE OR REPLACE where supported, else DROP + CREATE, inside a transaction.
export function StructureView(props: {
  connId: string;
  table: string;
  db?: string;
  schema?: string;
  /** Object kind; only a view can have its definition edited. */
  kind?: NodeKind;
  /** Active engine name, selects how the edited view is applied. */
  engine?: string;
  onClose: () => void;
  /** Called after a successful view apply, so the tree/data can refresh. */
  onApplied?: () => void;
}) {
  const [columns, setColumns] = createSignal<ResultSet | null>(null);
  const [ddl, setDdl] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [ddlError, setDdlError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  // View-editing state (issue #108).
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [applyError, setApplyError] = createSignal<string | null>(null);
  const [applied, setApplied] = createSignal(false);

  const isView = () => props.kind === "view";

  const loadDdl = async () => {
    const sql = await schemaDdl(props.connId, props.table, props.db, props.schema);
    setDdl(sql);
    return sql;
  };

  onMount(() => {
    // Load the column structure and the DDL INDEPENDENTLY: an engine that cannot
    // produce a CREATE statement (no get_ddl) must still show the columns, rather
    // than one failing call hiding the whole structure (issue: Informix DDL).
    void (async () => {
      try {
        setColumns(
          await schemaDescribe(props.connId, props.table, props.db, props.schema),
        );
      } catch (err) {
        setError(errorText(err));
      }
    })();
    void (async () => {
      try {
        await loadDdl();
      } catch (err) {
        setDdlError(errorText(err));
      }
    })();
  });

  const copyDdl = async () => {
    try {
      await navigator.clipboard.writeText(ddl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the DDL stays visible to copy manually */
    }
  };

  const startEdit = () => {
    setDraft(ddl());
    setApplyError(null);
    setApplied(false);
    setEditing(true);
  };

  // Beautify the view definition in place, reusing the same formatter as the SQL
  // editor (a no-op when the text can't be parsed — see sqlFormat.ts).
  const formatDraft = () => setDraft(formatSql(draft(), props.engine));

  // Qualified name used only as a fallback if the view name can't be read from
  // the DDL (see viewEdit.ts). Same quoting as generated SELECTs.
  const fallbackName = () =>
    qualifiedName({ db: props.db, schema: props.schema, name: props.table }, props.engine);

  const applyEdit = async () => {
    const plan = buildViewApply(props.engine ?? "", draft(), fallbackName());
    if (!plan.ok) {
      setApplyError(plan.error);
      return;
    }
    setBusy(true);
    setApplyError(null);
    try {
      await txBegin(props.connId);
      try {
        for (const sql of plan.statements) {
          await runQuery(props.connId, sql);
        }
        await txCommit(props.connId);
      } catch (err) {
        try {
          await txRollback(props.connId);
        } catch {
          /* best-effort rollback */
        }
        throw err;
      }
      await loadDdl();
      setEditing(false);
      setApplied(true);
      props.onApplied?.();
    } catch (err) {
      setApplyError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={`Estructura · ${props.table}`} wide onClose={props.onClose}>
      <h2>Estructura · {props.table}</h2>

        <Show when={error()}>
          <p class="test-error">{error()}</p>
        </Show>

        <Show when={columns()}>
          {(cols) => (
            // Scroll the column list within a capped height so a wide table does
            // not push the DDL off-screen (it keeps its own room below).
            <div class="struct-scroll">
              <table class="struct-table">
                <thead>
                  <tr>
                    <For each={cols().columns}>{(c) => <th>{c.name}</th>}</For>
                  </tr>
                </thead>
                <tbody>
                  <For each={cols().rows}>
                    {(row) => (
                      <tr>
                        <For each={row}>
                          {(cell) => <td>{cell ?? <span class="cell-null">NULL</span>}</td>}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          )}
        </Show>

        <div class="ddl-header">
          <span>{isView() ? "Definición" : "DDL"}</span>
          <span class="status-spacer" />
          <Show when={applied()}>
            <span class="test-ok">Vista actualizada.</span>
          </Show>
          <Show when={isView() && !editing()}>
            <button onClick={startEdit} disabled={!ddl()}>
              Editar definición
            </button>
          </Show>
          <Show when={editing()}>
            <button onClick={formatDraft} disabled={!draft()}>
              Formatear
            </button>
          </Show>
          <button onClick={copyDdl} disabled={!ddl() || editing()}>
            {copied() ? "¡Copiado!" : "Copiar DDL"}
          </button>
        </div>

        <Show
          when={editing()}
          fallback={
            <Show
              when={ddlError()}
              fallback={<pre class="ddl-text">{ddl() || "—"}</pre>}
            >
              <p class="test-error">DDL no disponible: {ddlError()}</p>
            </Show>
          }
        >
          <textarea
            class="ddl-edit"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            spellcheck={false}
          />
          <Show when={applyError()}>
            <p class="test-error">{applyError()}</p>
          </Show>
        </Show>

        <div class="modal-actions">
          <span class="status-spacer" />
          <Show
            when={editing()}
            fallback={<button onClick={props.onClose}>Cerrar</button>}
          >
            <button disabled={busy()} onClick={() => setEditing(false)}>
              Cancelar
            </button>
            <button class="primary" disabled={busy()} onClick={applyEdit}>
              {busy() ? "Aplicando…" : "Aplicar"}
            </button>
          </Show>
        </div>
    </Panel>
  );
}
