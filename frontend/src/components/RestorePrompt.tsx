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
  onBlank: () => void;
}) {
  // Escape starts clean: the safe half of the choice is the one that throws
  // nothing away — the saved workspace is still on disk until the first edit.
  return (
    <Dialog
      title={t("restore.title")}
      size="sm"
      class="restore-prompt"
      onCancel={props.onBlank}
      cancelLabel={t("restore.blank")}
      primary={{ label: t("restore.resume"), onClick: props.onResume }}
    >
      <p>{t("restore.message", { n: props.tabCount })}</p>
      <Show when={props.connections.length > 0}>
        <p class="restore-conns">{t("restore.conns", { names: props.connections.join(", ") })}</p>
      </Show>
    </Dialog>
  );
}
