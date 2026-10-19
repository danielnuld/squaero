import { For } from "solid-js";
import { SHORTCUTS, displayKeys, type Shortcut } from "../utils/shortcuts";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";

// Keyboard-shortcuts reference overlay (issue #42). Renders the single source
// of truth in utils/shortcuts.ts, so the documentation cannot drift from the
// behaviour. Opened with F1 (or the status-bar "?"), closed by Escape or its tab —
// no «Cerrar» of its own (audit A-21).
// App passes the effective table (the user's rebound keys applied, #684).
export function ShortcutsHelp(props: {
  isMac: boolean;
  shortcuts?: readonly Shortcut[];
  onClose: () => void;
}) {
  return (
    <Panel title={t("shortcuts.title")} class="shortcuts" onClose={props.onClose}>
      <h2>{t("shortcuts.title")}</h2>
      <table class="shortcuts-list">
          <tbody>
            <For each={props.shortcuts ?? SHORTCUTS}>
              {(s) => (
                <tr>
                  <td>{t(s.description)}</td>
                  <td class="keys">
                    <kbd>{displayKeys(s.keys, props.isMac)}</kbd>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
    </Panel>
  );
}
