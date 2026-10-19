import { Show } from "solid-js";
import { changeKinds, type PendingChanges } from "../utils/editSession";
import { t } from "../utils/i18n";

// The band under the grid while an edit session holds changes (R-26): how many,
// of which kind — with the same + ~ − glyphs as the row gutter, so the kind is
// not told by colour alone — the original values on demand, and the way to
// the SQL that saving will run. Presentational: the workspace owns the session.
export function PendingChangesBand(props: {
  pending: PendingChanges;
  /** Original values printed beside the changed cells. */
  showOld: boolean;
  busy: boolean;
  onToggleOld: () => void;
  /** Show the statements (the save preview). */
  onReview: () => void;
  onDiscard: () => void;
}) {
  const kinds = () => changeKinds(props.pending);
  const total = () => kinds().changed + kinds().added + kinds().removed;
  return (
    <div class="pending-band" role="region" aria-label={t("pending.bandLabel")}>
      <strong>
        {t(total() === 1 ? "pending.unsavedOne" : "pending.unsavedN", { n: total() })}
      </strong>
      <Show when={kinds().changed > 0}>
        <span class="pending-chip glyph-changed">~ {t("pending.kindChanged", { n: kinds().changed })}</span>
      </Show>
      <Show when={kinds().added > 0}>
        <span class="pending-chip glyph-added">+ {t("pending.kindAdded", { n: kinds().added })}</span>
      </Show>
      <Show when={kinds().removed > 0}>
        <span class="pending-chip glyph-removed">− {t("pending.kindRemoved", { n: kinds().removed })}</span>
      </Show>
      <span class="toolbar-spacer" />
      <button class="status-btn" aria-pressed={props.showOld} onClick={props.onToggleOld}>
        {t("pending.showOld")}
      </button>
      <button class="status-btn" disabled={props.busy} onClick={props.onReview}>
        {t("pending.showSql")}
      </button>
      <button class="status-btn danger" disabled={props.busy} onClick={props.onDiscard}>
        {t("pending.discard")}
      </button>
    </div>
  );
}
