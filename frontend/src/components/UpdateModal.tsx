import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { t } from "../utils/i18n";
import type { UpdateInfo } from "../utils/update";

// Startup update modal: shown when GitHub has a newer release. Presentational —
// App owns the check and the skip/close actions. Escape or a backdrop click just
// dismisses (it will reappear next launch); "Omitir esta versión" persists a skip.
//
// When the native in-app installer is available (onInstall + a .msi asset), the
// primary action downloads and runs it (the app then closes); otherwise it opens
// the download in the browser.
export function UpdateModal(props: {
  update: UpdateInfo | null;
  currentVersion: string;
  onClose: () => void;
  onSkip: (version: string) => void;
  onDownload: (url: string) => void;
  /** Native download-and-install; resolves false on failure (falls back to browser). */
  onInstall?: (url: string) => Promise<boolean>;
}) {
  const [installing, setInstalling] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (props.update && e.key === "Escape" && !installing()) props.onClose();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  // In-app install is offered only when both the bridge and a direct .msi exist.
  const canInAppInstall = () => !!props.onInstall && !!props.update?.downloadUrl;

  const doInstall = async () => {
    const url = props.update?.downloadUrl;
    if (!url || !props.onInstall) return;
    setError(null);
    setInstalling(true);
    const ok = await props.onInstall(url);
    if (!ok) {
      setInstalling(false);
      setError(t("upd.downloadFailed"));
    }
    // On success the app closes and the installer runs; nothing more to do here.
  };

  return (
    <Show when={props.update}>
      <div class="update-backdrop" onMouseDown={() => !installing() && props.onClose()}>
        <div
          class="update-modal"
          role="dialog"
          aria-label={t("upd.available")}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div class="update-head">
            <span class="update-badge">{t("upd.badge")}</span>
            <h2>{t("upd.heading", { version: props.update!.version })}</h2>
            <p class="update-sub">{t("upd.current", { version: props.currentVersion })}</p>
          </div>

          <div class="update-notes">
            <Show
              when={props.update!.notes.trim()}
              fallback={<p class="sidebar-hint">{t("upd.noNotes")}</p>}
            >
              <pre>{props.update!.notes}</pre>
            </Show>
          </div>

          <Show when={error()}>
            <p class="update-error">{error()}</p>
          </Show>

          {/* Composed with modal-actions, like every other dialog footer: on its
              own this row's buttons fell back to the OS look, so the modal mixed
              one styled button with three system ones. */}
          <div class="modal-actions update-actions">
            <button class="update-skip" disabled={installing()} onClick={() => props.onSkip(props.update!.version)}>
              {t("upd.skip")}
            </button>
            <span class="status-spacer" />
            <button disabled={installing()} onClick={() => props.onClose()}>
              {t("upd.later")}
            </button>
            <Show
              when={canInAppInstall()}
              fallback={
                <button
                  class="primary"
                  onClick={() =>
                    props.onDownload(props.update!.downloadUrl ?? props.update!.releaseUrl)
                  }
                >
                  {props.update!.downloadUrl ? t("upd.download") : t("upd.viewRelease")}
                </button>
              }
            >
              <button class="update-browser" disabled={installing()} onClick={() => props.onDownload(props.update!.downloadUrl!)}>
                {t("upd.inBrowser")}
              </button>
              <button class="primary" disabled={installing()} onClick={() => void doInstall()}>
                {installing() ? t("upd.installing") : t("upd.install")}
              </button>
              {/* Dicho antes de pulsar, no después: la app se cierra sola para
                  que el instalador pueda reemplazarla, y eso sin avisar parece
                  que se ha caído (issue #485). */}
              <p class="update-note">{t("upd.restartNote")}</p>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
