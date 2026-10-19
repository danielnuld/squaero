import { For, Show, createSignal } from "solid-js";
import { SHORTCUTS, formatKeys, keyParams, shortcutText, type ActionId, type Shortcut } from "../utils/shortcuts";
import { SHORTCUT_GROUPS, groupShortcuts, type ShortcutGroup } from "../utils/shortcutGroups";
import type { Os } from "../utils/dialog";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";

// Keyboard-shortcuts reference overlay (issue #42). Renders the single source
// of truth in utils/shortcuts.ts, so the documentation cannot drift from the
// behaviour. Opened with F1 (or the status-bar "?"), closed by Escape or its tab —
// no «Cerrar» of its own (audit A-21).
// App passes the effective table (the user's rebound keys applied, #684).
//
// M14 ShortcutsHelp: grouped by area, searchable by name or keys, a filter by
// group, a dot on the ones the user changed, and «Personalizar» to edit them.
export function ShortcutsHelp(props: {
  isMac: boolean;
  shortcuts?: readonly Shortcut[];
  /** Actions whose keys the user changed. */
  customized?: ReadonlySet<ActionId>;
  /** Opens Ajustes › Atajos de teclado. */
  onCustomize?: () => void;
  onClose: () => void;
}) {
  const os = (): Os => (props.isMac ? "macos" : "windows");
  const [query, setQuery] = createSignal("");
  const [group, setGroup] = createSignal<ShortcutGroup | "all">("all");
  const groups = () =>
    groupShortcuts(props.shortcuts ?? SHORTCUTS, {
      query: query(),
      group: group(),
      text: (sc) => shortcutText(sc, os()),
      os: os(),
    });
  const filters: (ShortcutGroup | "all")[] = ["all", ...SHORTCUT_GROUPS];

  return (
    <Panel title={t("shortcuts.title")} class="shortcuts" onClose={props.onClose}>
      <div class="shortcuts-head">
        <h2>{t("shortcuts.title")}</h2>
        <span class="toolbar-spacer" />
        <Show when={props.onCustomize}>
          <button type="button" class="btn" onClick={() => props.onCustomize?.()}>
            {t("shortcuts.customize")}
          </button>
        </Show>
      </div>
      <p class="help">{t("shortcuts.help", keyParams({ help: "F1" }, os()))}</p>
      <div class="shortcuts-filters">
        <input
          type="search"
          class="shortcuts-search"
          placeholder={t("shortcuts.search")}
          aria-label={t("shortcuts.search")}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <span class="seg" role="radiogroup" aria-label={t("shortcuts.groupAria")}>
          <For each={filters}>
            {(g) => (
              <button
                type="button"
                role="radio"
                class="seg-btn"
                classList={{ on: group() === g }}
                aria-checked={group() === g}
                onClick={() => setGroup(g)}
              >
                {t(`shortcuts.group.${g}`)}
              </button>
            )}
          </For>
        </span>
      </div>
      <For
        each={groups()}
        fallback={<p class="help">{t("shortcuts.none", { query: query().trim() })}</p>}
      >
        {(g) => (
          <section class="shortcuts-group" aria-label={t(`shortcuts.group.${g.group}`)}>
            <h3>{t(`shortcuts.group.${g.group}`)}</h3>
            <table class="shortcuts-list">
              <tbody>
                <For each={g.items}>
                  {(s) => (
                    <tr>
                      <td>
                        {shortcutText(s, os())}
                        <Show when={props.customized?.has(s.id)}>
                          <span
                            class="shortcuts-custom"
                            role="img"
                            aria-label={t("settings.sc.custom")}
                            title={t("settings.sc.custom")}
                          />
                        </Show>
                      </td>
                      <td class="keys">
                        <Show when={s.keys} fallback={<span class="sc-none">{t("settings.sc.none")}</span>}>
                          <kbd>{formatKeys(s.keys, os())}</kbd>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </section>
        )}
      </For>
    </Panel>
  );
}
