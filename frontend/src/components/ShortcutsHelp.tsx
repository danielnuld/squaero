import { For } from "solid-js";
import { SHORTCUTS, displayKeys } from "../utils/shortcuts";
import { Panel } from "./Panel";

// Keyboard-shortcuts reference overlay (issue #42). Renders the single source
// of truth in utils/shortcuts.ts, so the documentation cannot drift from the
// behaviour. Opened with F1 (or the status-bar "?"), closed by Escape/clicking away.
export function ShortcutsHelp(props: { isMac: boolean; onClose: () => void }) {
  return (
    <Panel title="Atajos de teclado" class="shortcuts" onClose={props.onClose}>
      <h2>Atajos de teclado</h2>
      <table class="shortcuts-list">
          <tbody>
            <For each={SHORTCUTS}>
              {(s) => (
                <tr>
                  <td>{s.description}</td>
                  <td class="keys">
                    <kbd>{displayKeys(s.keys, props.isMac)}</kbd>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      <div class="modal-actions">
        <button class="primary" onClick={props.onClose}>
          Cerrar
        </button>
      </div>
    </Panel>
  );
}
