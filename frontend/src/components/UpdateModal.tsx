import { Show, createSignal } from "solid-js";
import { Dialog } from "./Dialog";
import { t } from "../utils/i18n";
import type { UpdateInfo } from "../utils/update";

// Startup update modal: shown when GitHub has a newer release. Presentational —
// App owns the check and the skip/close actions. Escape, a backdrop click or
// «Más tarde» just dismiss (it reappears next launch); «Omitir esta versión»
// persists a skip. Built on the shared Dialog (issue #692).
//
// When the native in-app installer is available (onInstall + a .msi asset), the
// primary action downloads and runs it (the app then closes); otherwise it opens
// the release page in the browser.
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
      {(u) => (
        <Dialog
          title={t("upd.heading", { version: u().version })}
          size="md"
          class="update-modal"
          busy={installing()}
          error={error()}
          onCancel={() => props.onClose()}
          cancelLabel={t("upd.later")}
          primary={
            canInAppInstall()
              ? { label: installing() ? t("upd.installing") : t("upd.install"), onClick: () => void doInstall() }
              : { label: t("upd.viewRelease"), onClick: () => props.onDownload(u().releaseUrl) }
          }
          helpers={
            <span class="update-actions">
              <button type="button" class="btn update-skip" disabled={installing()} onClick={() => props.onSkip(u().version)}>
                {t("upd.skip")}
              </button>
              {/* Without the native installer — Linux, or a release with no MSI —
                  the release page is the only honest target: the direct asset is
                  the Windows MSI, useless to anyone else (issue #40). */}
              <Show when={canInAppInstall()}>
                <button
                  type="button"
                  class="btn update-browser"
                  disabled={installing()}
                  onClick={() => props.onDownload(u().downloadUrl!)}
                >
                  {t("upd.inBrowser")}
                </button>
              </Show>
            </span>
          }
        >
          <p class="update-sub">
            <span class="update-badge">{t("upd.badge")}</span> {t("upd.current", { version: props.currentVersion })}
          </p>
          <div class="update-notes">
            <Show when={u().notes.trim()} fallback={<p class="sidebar-hint">{t("upd.noNotes")}</p>}>
              <pre>{u().notes}</pre>
            </Show>
          </div>
          {/* Dicho antes de pulsar, no después: la app se cierra sola para que
              el instalador pueda reemplazarla, y eso sin avisar parece que se ha
              caído (issue #485). */}
          <Show when={canInAppInstall()}>
            <p class="update-note">{t("upd.restartNote")}</p>
          </Show>
        </Dialog>
      )}
    </Show>
  );
}
