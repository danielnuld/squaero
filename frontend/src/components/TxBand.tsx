import { For, Show } from "solid-js";
import { t } from "../utils/i18n";
import type { TxSession } from "../utils/txMode";
import { Icon } from "./icons";

// The open-transaction band over the results (M14 TxManualPending, audit A-07):
// while the tab's connection holds a transaction, a persistent amber line says
// so — how many statements wait, that only this session sees them — with Commit
// and Revertir as buttons and the statements themselves one click away.
// Presentational: the workspace owns the session (utils/txMode.ts) and the calls.
export function TxBand(props: {
  session: TxSession;
  busy?: boolean;
  /** Display labels of the shortcuts, when bound. */
  commitKeys?: string;
  rollbackKeys?: string;
  onCommit: () => void;
  onRollback: () => void;
}) {
  const n = () => props.session.statements;
  const log = () => props.session.log ?? [];
  return (
    <div class="tx-band" role="status" aria-label={t("tx.bandAria")}>
      <div class="tx-band-line">
        <Icon name="warning" size={14} class="tx-band-ic" />
        <span class="tx-band-title">
          {n() === 1 ? t("tx.bandOne") : t("tx.band", { n: n() })}
        </span>
        <span class="help" title={t("tx.bandHelpTitle")}>
          {t("tx.bandHelp")}
        </span>
        <span class="toolbar-spacer" />
        <button
          type="button"
          class="btn"
          title={t("tx.commitTitle")}
          disabled={props.busy}
          onClick={() => props.onCommit()}
        >
          {t("tx.commit")}
          <Show when={props.commitKeys}>
            <kbd>{props.commitKeys}</kbd>
          </Show>
        </button>
        <button
          type="button"
          class="btn"
          title={t("tx.rollbackTitle")}
          disabled={props.busy}
          onClick={() => props.onRollback()}
        >
          {t("tx.rollback")}
          <Show when={props.rollbackKeys}>
            <kbd>{props.rollbackKeys}</kbd>
          </Show>
        </button>
      </div>
      <Show when={log().length > 0}>
        <details class="tx-band-list">
          <summary>{t("tx.bandList")}</summary>
          <ol>
            <For each={log()}>
              {(e) => (
                <li>
                  <span class="mono">{e.sql}</span>
                  <Show when={e.rows !== null}>
                    <span class="num">
                      {e.rows === 1 ? t("tx.rowsOne") : t("tx.rows", { n: e.rows! })}
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ol>
        </details>
      </Show>
    </div>
  );
}
