import { For, Show } from "solid-js";
import { EmptyNote } from "./EmptyNote";
import type { TreeNode } from "../utils/tree";
import type { HistoryEntry } from "../utils/history";
import type { Snippet } from "../utils/snippets";
import { SHORTCUTS, formatKeys, shortcutText, type Shortcut } from "../utils/shortcuts";
import { t } from "../utils/i18n";

// Useful editor empty state (issue #178): instead of a bare "run a query"
// message, offer quick access to recently-opened tables, the last executed
// queries, saved snippets, and the main shortcuts. Shown only when the active
// tab has no result; each action does exactly what its origin does (history →
// new tab + run, snippet → insert at cursor, table → open its data). Purely
// presentational — App passes the data and the same handlers those origins use.
//
// M14 (issue #691, EditorEmpty): the app's one empty pattern on top — a short
// title, the two run keys in one sentence, one primary action (a snippet) —
// then the cards, each with its way to the rest («Ver el historial», «Todos los
// atajos»). No wordmark: the result pane is not a splash screen.

const MAX_ITEMS = 5;

// The shortcuts most relevant while composing a query, in a fixed useful order.
const KEY_SHORTCUTS: Shortcut["id"][] = ["run-query", "run-script", "format-sql", "snippet-palette", "new-tab"];

export function EmptyState(props: {
  recentTables: TreeNode[];
  history: HistoryEntry[];
  snippets: Snippet[];
  isMac: boolean;
  /** The effective table (rebound keys applied, #684); the defaults when omitted. */
  shortcuts?: readonly Shortcut[];
  onOpenTable: (node: TreeNode) => void;
  onRunHistory: (sql: string) => void;
  onInsertSnippet: (s: Snippet) => void;
  /** The primary action: pick a snippet to insert; absent → none offered. */
  onPickSnippet?: () => void;
  /** «Ver el historial» under the recent queries. */
  onHistory?: () => void;
  /** «Todos los atajos» under the shortcuts (F1). */
  onAllShortcuts?: () => void;
}) {
  const shortcuts = () =>
    KEY_SHORTCUTS.map((id) => (props.shortcuts ?? SHORTCUTS).find((s) => s.id === id)).filter(
      (s): s is Shortcut => !!s,
    );

  const keysOf = (id: Shortcut["id"], fallback: string) =>
    formatKeys((props.shortcuts ?? SHORTCUTS).find((s) => s.id === id)?.keys ?? fallback, props.isMac ? "macos" : "windows");

  return (
    <div class="empty-state">
      <EmptyNote
        title={t("empty.lead")}
        text={t("empty.keys", {
          run: keysOf("run-query", "Mod+Enter"),
          script: keysOf("run-script", "Mod+Shift+Enter"),
        })}
        action={
          props.onPickSnippet ? { label: t("empty.pickSnippet"), onClick: props.onPickSnippet } : undefined
        }
      />
      <div class="empty-state-cards">
        <Show when={props.recentTables.length > 0}>
          <section class="empty-card">
            <h4>{t("empty.recentTables")}</h4>
            <ul>
              <For each={props.recentTables.slice(0, MAX_ITEMS)}>
                {(node) => (
                  <li>
                    <button class="empty-link" title={t("empty.openTable", { name: node.label })} onClick={() => props.onOpenTable(node)}>
                      {node.label}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <Show when={props.history.length > 0}>
          <section class="empty-card">
            <h4>{t("empty.recentQueries")}</h4>
            <ul>
              <For each={props.history.slice(0, MAX_ITEMS)}>
                {(h) => (
                  <li>
                    <button
                      class="empty-link empty-sql"
                      title={t("empty.rerunNewTab")}
                      onClick={() => props.onRunHistory(h.sql)}
                    >
                      {h.sql}
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <Show when={props.onHistory}>
              <button class="empty-link empty-more" onClick={() => props.onHistory!()}>
                {t("empty.allHistory")}
              </button>
            </Show>
          </section>
        </Show>

        <Show when={props.snippets.length > 0}>
          <section class="empty-card">
            <h4>{t("editor.snippets")}</h4>
            <ul>
              <For each={props.snippets.slice(0, MAX_ITEMS)}>
                {(s) => (
                  <li>
                    <button
                      class="empty-link"
                      title={t("empty.insertSnippet")}
                      onClick={() => props.onInsertSnippet(s)}
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
          <h4>{t("empty.shortcuts")}</h4>
          <ul class="empty-shortcuts">
            <For each={shortcuts()}>
              {(s) => (
                <li>
                  <span>{shortcutText(s, props.isMac ? "macos" : "windows")}</span>
                  <kbd>{formatKeys(s.keys, props.isMac ? "macos" : "windows")}</kbd>
                </li>
              )}
            </For>
          </ul>
          <Show when={props.onAllShortcuts}>
            <button class="empty-link empty-more" onClick={() => props.onAllShortcuts!()}>
              {t("empty.allShortcuts")}
            </button>
          </Show>
        </section>
      </div>
    </div>
  );
}
