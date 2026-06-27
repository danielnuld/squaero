import { For, Show, createSignal, onMount } from "solid-js";
import { schemaDescribe, schemaDdl } from "../utils/schema";
import type { ResultSet } from "../utils/query";

// Modal showing a table's structure: the column list (from schema.describe) and
// the engine's CREATE statement (from schema.ddl) with a copy button (#20/#21).
export function StructureView(props: {
  connId: string;
  table: string;
  onClose: () => void;
}) {
  const [columns, setColumns] = createSignal<ResultSet | null>(null);
  const [ddl, setDdl] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  onMount(() => {
    void (async () => {
      try {
        const [cols, sql] = await Promise.all([
          schemaDescribe(props.connId, props.table),
          schemaDdl(props.connId, props.table),
        ]);
        setColumns(cols);
        setDdl(sql);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
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

  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Estructura · {props.table}</h2>

        <Show when={error()}>
          <p class="test-error">{error()}</p>
        </Show>

        <Show when={columns()}>
          {(cols) => (
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
          )}
        </Show>

        <div class="ddl-header">
          <span>DDL</span>
          <button onClick={copyDdl} disabled={!ddl()}>
            {copied() ? "¡Copiado!" : "Copiar DDL"}
          </button>
        </div>
        <pre class="ddl-text">{ddl() || "—"}</pre>

        <div class="modal-actions">
          <span class="status-spacer" />
          <button onClick={props.onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
