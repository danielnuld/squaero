import { Show } from "solid-js";
import { t } from "../utils/i18n";
import type { TxSession } from "../utils/txMode";

// The editor bar's transaction controls (issue #667): the auto-commit / manual
// switch of the tab's connection and, while a transaction is open, how many
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
  return (
    <span class="tx-controls">
      <button
        class="status-btn tx-mode"
        classList={{ "is-manual": props.session.manual }}
        aria-pressed={props.session.manual}
        disabled={!!toggleBlocked() || props.busy}
        title={
          toggleBlocked() ??
          t(props.session.manual ? "tx.modeTitleManual" : "tx.modeTitleAuto")
        }
        onClick={() => props.onToggle()}
      >
        {t(props.session.manual ? "tx.manual" : "tx.auto")}
      </button>
      <Show when={props.session.open}>
        <span
          class="tx-open"
          role="status"
          title={t("tx.openTitle", { n: props.session.statements })}
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
