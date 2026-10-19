import { Show } from "solid-js";
import { Dialog } from "./Dialog";
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
  /** «Descartar pestañas»: start clean and let the saved session go. */
  onDiscard: () => void;
  /** Esc, × and «Ahora no»: decide later, the saved session kept for the next
      start (audit R-37, A-36: Esc never throws work away). */
  onLater: () => void;
}) {
  return (
    <Dialog
      title={t("restore.title")}
      size="sm"
      class="restore-prompt"
      onCancel={props.onLater}
      cancelLabel={t("restore.later")}
      helpers={
        <button type="button" class="btn" onClick={props.onDiscard}>
          {t("restore.discard")}
        </button>
      }
      primary={{ label: t("restore.resume"), onClick: props.onResume }}
    >
      <p>{t("restore.message", { n: props.tabCount })}</p>
      <Show when={props.connections.length > 0}>
        <p class="restore-conns">{t("restore.conns", { names: props.connections.join(", ") })}</p>
      </Show>
      <p class="help">{t("restore.laterHelp")}</p>
    </Dialog>
  );
}
