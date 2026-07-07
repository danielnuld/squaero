import { Show, onCleanup, onMount } from "solid-js";
import type { UpdateInfo } from "../utils/update";

// Startup update modal: shown when GitHub has a newer release. Presentational —
// App owns the check and the skip/close actions. Escape or a backdrop click just
// dismisses (it will reappear next launch); "Omitir esta versión" persists a skip.
export function UpdateModal(props: {
  update: UpdateInfo | null;
  currentVersion: string;
  onClose: () => void;
  onSkip: (version: string) => void;
  onDownload: (url: string) => void;
}) {
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (props.update && e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={props.update}>
      <div class="update-backdrop" onMouseDown={() => props.onClose()}>
        <div
          class="update-modal"
          role="dialog"
          aria-label="Actualización disponible"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div class="update-head">
            <span class="update-badge">Actualización</span>
            <h2>Quaero {props.update!.version} disponible</h2>
            <p class="update-sub">
              Tienes la versión {props.currentVersion}.
            </p>
          </div>

          <div class="update-notes">
            <Show
              when={props.update!.notes.trim()}
              fallback={<p class="sidebar-hint">Sin notas para esta versión.</p>}
            >
              <pre>{props.update!.notes}</pre>
            </Show>
          </div>

          <div class="update-actions">
            <button
              class="update-skip"
              onClick={() => props.onSkip(props.update!.version)}
            >
              Omitir esta versión
            </button>
            <span class="status-spacer" />
            <button onClick={() => props.onClose()}>Ahora no</button>
            <button
              class="primary"
              onClick={() =>
                props.onDownload(props.update!.downloadUrl ?? props.update!.releaseUrl)
              }
            >
              {props.update!.downloadUrl ? "Descargar" : "Ver release"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
