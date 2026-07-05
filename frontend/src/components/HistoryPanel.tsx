import { For, Show, createMemo, createSignal } from "solid-js";
import { Panel } from "./Panel";
import { searchHistory, type HistoryEntry } from "../utils/history";

// Query-history panel (issue #128): search executed queries and re-run one in a
// new tab. Filtering is pure (searchHistory); the clear action is lifted to the
// workspace, which owns persistence. The saved-entry limit is now configured in
// the Settings panel (issue #181), not here. Opened from the editor bar.
export function HistoryPanel(props: {
  entries: HistoryEntry[];
  onRun: (sql: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const results = createMemo(() => searchHistory(props.entries, query()));

  const pick = (sql: string) => {
    props.onRun(sql);
    props.onClose();
  };

  return (
    <Panel title="Historial de consultas" class="history" onClose={props.onClose}>
      <h2>Historial de consultas</h2>
      <div class="history-controls">
        <input
          class="history-search"
          type="search"
          placeholder="Buscar en el historial…"
          aria-label="Buscar en el historial"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          autofocus
        />
      </div>

      <Show
        when={results().length > 0}
        fallback={
          <p class="history-empty">
            {props.entries.length === 0
              ? "Aún no has ejecutado consultas."
              : "Ninguna consulta coincide con la búsqueda."}
          </p>
        }
      >
        <ul class="history-list">
          <For each={results()}>
            {(e) => (
              <li class="history-item">
                <button
                  class="history-run"
                  title="Reejecutar en una pestaña nueva"
                  onClick={() => pick(e.sql)}
                >
                  <span class="history-sql">{e.sql}</span>
                  <span class="history-meta">
                    {e.connName || "sin conexión"} · {new Date(e.ts).toLocaleString()}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class="modal-actions">
        <button
          class="danger"
          onClick={props.onClear}
          disabled={props.entries.length === 0}
        >
          Limpiar historial
        </button>
        <button class="primary" onClick={props.onClose}>
          Cerrar
        </button>
      </div>
    </Panel>
  );
}
