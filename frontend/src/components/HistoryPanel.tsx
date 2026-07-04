import { For, Show, createMemo, createSignal } from "solid-js";
import { Panel } from "./Panel";
import {
  searchHistory,
  clampLimit,
  MIN_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  type HistoryEntry,
} from "../utils/history";

// Query-history panel (issue #128): search executed queries and re-run one in a
// new tab. Filtering is pure (searchHistory); the configurable limit and the
// clear action are lifted to the workspace, which owns persistence. Opened from
// the editor bar, closed by Escape / clicking away (Modal).
export function HistoryPanel(props: {
  entries: HistoryEntry[];
  limit: number;
  onRun: (sql: string) => void;
  onClear: () => void;
  onChangeLimit: (n: number) => void;
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
        <label class="history-limit" title="Máximo de consultas guardadas">
          Límite
          <input
            type="number"
            min={MIN_HISTORY_LIMIT}
            max={MAX_HISTORY_LIMIT}
            value={props.limit}
            onChange={(e) => props.onChangeLimit(clampLimit(Number(e.currentTarget.value)))}
          />
        </label>
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
