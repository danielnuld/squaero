import { For, Show } from "solid-js";
import { BrandWordmark } from "./Brand";
import type { TreeNode } from "../utils/tree";
import type { HistoryEntry } from "../utils/history";
import type { Snippet } from "../utils/snippets";
import { SHORTCUTS, displayKeys, type Shortcut } from "../utils/shortcuts";

// Useful editor empty state (issue #178): instead of a bare "run a query"
// message, offer quick access to recently-opened tables, the last executed
// queries, saved snippets, and the main shortcuts. Shown only when the active
// tab has no result; each action does exactly what its origin does (history →
// new tab + run, snippet → insert at cursor, table → open its data). Purely
// presentational — App passes the data and the same handlers those origins use.

const MAX_ITEMS = 5;

// The shortcuts most relevant while composing a query, in a fixed useful order.
const KEY_SHORTCUTS: Shortcut["id"][] = ["run-query", "format-sql", "new-tab", "toggle-help"];

export function EmptyState(props: {
  recentTables: TreeNode[];
  history: HistoryEntry[];
  snippets: Snippet[];
  isMac: boolean;
  onOpenTable: (node: TreeNode) => void;
  onRunHistory: (sql: string) => void;
  onInsertSnippet: (body: string) => void;
}) {
  const shortcuts = () =>
    KEY_SHORTCUTS.map((id) => SHORTCUTS.find((s) => s.id === id)).filter(
      (s): s is Shortcut => !!s,
    );

  const hasAny = () =>
    props.recentTables.length > 0 || props.history.length > 0 || props.snippets.length > 0;

  return (
    <div class="empty-state">
      <div class="empty-state-brand">
        <BrandWordmark height={40} />
      </div>
      <p class="empty-state-lead">Ejecuta una consulta para ver resultados.</p>
      <div class="empty-state-cards">
        <Show when={props.recentTables.length > 0}>
          <section class="empty-card">
            <h4>Tablas recientes</h4>
            <ul>
              <For each={props.recentTables.slice(0, MAX_ITEMS)}>
                {(t) => (
                  <li>
                    <button class="empty-link" title={`Abrir ${t.label}`} onClick={() => props.onOpenTable(t)}>
                      {t.label}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={props.history.length > 0}>
          <section class="empty-card">
            <h4>Consultas recientes</h4>
            <ul>
              <For each={props.history.slice(0, MAX_ITEMS)}>
                {(h) => (
                  <li>
                    <button
                      class="empty-link empty-sql"
                      title="Reejecutar en una pestaña nueva"
                      onClick={() => props.onRunHistory(h.sql)}
                    >
                      {h.sql}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={props.snippets.length > 0}>
          <section class="empty-card">
            <h4>Snippets</h4>
            <ul>
              <For each={props.snippets.slice(0, MAX_ITEMS)}>
                {(s) => (
                  <li>
                    <button
                      class="empty-link"
                      title="Insertar en el editor"
                      onClick={() => props.onInsertSnippet(s.body)}
                    >
                      {s.name}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <section class="empty-card">
          <h4>Atajos</h4>
          <ul class="empty-shortcuts">
            <For each={shortcuts()}>
              {(s) => (
                <li>
                  <span>{s.description}</span>
                  <kbd>{displayKeys(s.keys, props.isMac)}</kbd>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>
      <Show when={!hasAny()}>
        <p class="empty-state-hint">
          Abre una tabla del árbol o escribe SQL y pulsa {displayKeys("Mod+Enter", props.isMac)}.
        </p>
      </Show>
    </div>
  );
}
