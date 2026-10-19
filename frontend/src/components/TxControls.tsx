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
      <span
        class="seg tx-mode"
        classList={{ "is-manual": props.session.manual }}
        role="radiogroup"
        aria-label={t("tx.modeAria")}
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            const group = e.currentTarget;
            if (!locked()) {
              props.onToggle();
              // The checked option takes the focus, as a radio group's does.
              queueMicrotask(() =>
                group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
              );
            }
          }
        }}
      >
        <button
          type="button"
          role="radio"
          class="seg-btn"
          classList={{ on: !props.session.manual }}
          aria-checked={!props.session.manual}
          tabIndex={props.session.manual ? -1 : 0}
          disabled={locked()}
          title={toggleBlocked() ?? t("tx.modeTitleAuto")}
          onClick={() => props.session.manual && props.onToggle()}
        >
          {t("tx.auto")}
        </button>
        <button
          type="button"
          role="radio"
          class="seg-btn"
          classList={{ on: props.session.manual }}
          aria-checked={props.session.manual}
          tabIndex={props.session.manual ? 0 : -1}
          disabled={locked()}
          title={toggleBlocked() ?? t("tx.modeTitleManual")}
          onClick={() => !props.session.manual && props.onToggle()}
        >
          {t("tx.manual")}
        </button>
      </span>
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
