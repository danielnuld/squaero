import { Show, onCleanup, onMount } from "solid-js";
import { t } from "../utils/i18n";

// The choice at startup (issue #465): pick up the last session, or start clean.
//
// The workspace has come back on its own since #401, which is right when you
// were interrupted and wrong when you have moved on: the tabs of a task you
// finished yesterday reopen every morning, and closing them one by one is the
// first thing the app asks of you. So it asks instead — but only when there is
// something to ask about (worthRestoring), never for the one empty tab the app
// would open anyway.
//
// Resuming also reopens the connections those tabs are bound to, which is the
// other half of the complaint: a restored tab used to come back saying its
// connection was closed.
export function RestorePrompt(props: {
  /** How many query tabs are waiting. */
  tabCount: number;
  /** Names of the connections resuming would reopen (may be empty). */
  connections: string[];
  onResume: () => void;
  onBlank: () => void;
}) {
  // Escape starts clean: the safe half of the choice is the one that throws
  // nothing away — the saved workspace is still on disk until the first edit.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    props.onBlank();
  };
  let resumeBtn: HTMLButtonElement | undefined;
  onMount(() => {
    document.addEventListener("keydown", onKeyDown, true);
    resumeBtn?.focus();
  });
  onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));

  return (
    <div class="modal-backdrop">
      <div class="modal restore-prompt" role="dialog" aria-modal="true" aria-labelledby="restore-title">
        <h2 id="restore-title">{t("restore.title")}</h2>
        <p>{t("restore.message", { n: props.tabCount })}</p>
        <Show when={props.connections.length > 0}>
          <p class="restore-conns">
            {t("restore.conns", { names: props.connections.join(", ") })}
          </p>
        </Show>
        <div class="modal-actions">
          <button onClick={props.onBlank}>{t("restore.blank")}</button>
          <button class="primary" ref={resumeBtn} onClick={props.onResume}>
            {t("restore.resume")}
          </button>
        </div>
      </div>
    </div>
  );
}
