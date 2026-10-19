import { Segmented } from "./Segmented";
import { countText } from "../utils/confirmText";
import { Show } from "solid-js";
import { t } from "../utils/i18n";
import type { TxSession } from "../utils/txMode";

// The editor bar's transaction controls (issues #667, #691): the Auto | Manual
// segmented switch of the tab's connection and, while a transaction is open, how many
// statements ran in it plus Commit and Rollback. Presentational: the workspace
// owns the state (utils/txMode.ts) and the calls.
export function TxControls(props: {
  session: TxSession;
  /** Why the switch cannot be used (engine without transactions); null = usable. */
  unsupportedReason?: string | null;
  busy?: boolean;
  onToggle: () => void;
  onCommit: () => void;
  onRollback: () => void;
}) {
  // Leaving manual mode with a transaction open would leave it dangling.
  const toggleBlocked = () => props.unsupportedReason ?? (props.session.open ? t("tx.closeFirst") : null);
  const locked = () => !!toggleBlocked() || !!props.busy;
  return (
    <span class="tx-controls">
      {/* Auto | Manual as the prototype's segmented control (TxControlsMenu):
          a radio group, so the mode in force reads at a glance and the arrow
          keys move between the two like any radio group. */}
      <Segmented
        class={`tx-mode${props.session.manual ? " is-manual" : ""}`}
        label={t("tx.modeAria")}
        options={[
          { value: false, label: t("tx.auto"), title: toggleBlocked() ?? t("tx.modeTitleAuto"), disabled: locked() },
          { value: true, label: t("tx.manual"), title: toggleBlocked() ?? t("tx.modeTitleManual"), disabled: locked() },
        ]}
        value={props.session.manual}
        onChange={(manual) => manual !== props.session.manual && props.onToggle()}
      />
      <Show when={props.session.open}>
        <span
          class="tx-open"
          role="status"
          title={countText("tx.openTitle", props.session.statements)}
        >
          {t("tx.open", { n: props.session.statements })}
        </span>
        <button
          class="status-btn"
          title={t("tx.commitTitle")}
          disabled={props.busy}
          onClick={() => props.onCommit()}
        >
          {t("tx.commit")}
        </button>
        <button
          class="status-btn danger"
          title={t("tx.rollbackTitle")}
          disabled={props.busy}
          onClick={() => props.onRollback()}
        >
          {t("tx.rollback")}
        </button>
      </Show>
    </span>
  );
}
