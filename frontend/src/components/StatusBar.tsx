import { Show } from "solid-js";

// Bottom status bar: active connection, row count of the current result, and
// the elapsed time of the last query. Values are passed in by the workspace.
export function StatusBar(props: {
  connection: string | null;
  rowCount: number | null;
  truncated: boolean;
  elapsedMs: number | null;
}) {
  return (
    <footer class="statusbar">
      <span class="status-item">
        <span class={`conn-dot ${props.connection ? "on" : "off"}`} />
        {props.connection ?? "Sin conexión"}
      </span>
      <span class="status-spacer" />
      <Show when={props.rowCount !== null}>
        <span class="status-item">
          {props.rowCount} fila{props.rowCount === 1 ? "" : "s"}
          {props.truncated ? "+" : ""}
        </span>
      </Show>
      <Show when={props.elapsedMs !== null}>
        <span class="status-item">{props.elapsedMs!.toFixed(0)} ms</span>
      </Show>
    </footer>
  );
}
