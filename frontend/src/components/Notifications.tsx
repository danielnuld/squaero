import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { t, locale } from "../utils/i18n";
import { timeAgo } from "../utils/history";
import { formatClock } from "../utils/duration";
import type { Note, NoteLevel } from "../utils/notifications";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon, type IconName } from "./icons";

const LEVEL_ICON: Record<NoteLevel, IconName> = {
  info: "info",
  ok: "check",
  warn: "warning",
  error: "warning",
};

// The notification history (issue #693): what the toasts said, newest first,
// with when and how serious. Opened from the bell in the title bar; Esc or a click
// outside closes it. Emptying it asks first, through the app's confirmation.
export function Notifications(props: {
  notes: readonly Note[];
  onClear: () => void;
  onClose: () => void;
  /** Injected in tests; Date.now otherwise. */
  now?: () => number;
}) {
  const [confirming, setConfirming] = createSignal(false);
  let box: HTMLElement | undefined;
  const now = () => (props.now ?? Date.now)();

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirming()) props.onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (confirming() || box?.contains(target)) return;
      // The bell toggles the panel itself.
      if ((target as Element).closest?.(".tb-bell")) return;
      props.onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    });
  });

  return (
    <section class="notes-panel" aria-labelledby="notes-title" ref={box}>
      <div class="notes-head">
        <h2 id="notes-title">{t("notes.title")}</h2>
        <button
          class="dlg-close"
          title={t("panel.close")}
          aria-label={t("panel.close")}
          onClick={() => props.onClose()}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <Show
        when={props.notes.length > 0}
        fallback={
          <div class="empty-note">
            <span class="empty-note-title">{t("notes.emptyTitle")}</span>
            <span>{t("notes.emptyText")}</span>
          </div>
        }
      >
        <ul class="notes-list" aria-label={t("notes.title")}>
          <For each={props.notes}>
            {(n) => (
              <li class={`notes-item level-${n.level}`}>
                <span class="notes-icon" aria-label={t(`notes.level.${n.level}`)} role="img">
                  <Icon name={LEVEL_ICON[n.level]} size={14} />
                </span>
                <span class="notes-text">{n.text}</span>
                <time
                  class="notes-time"
                  dateTime={new Date(n.at).toISOString()}
                  title={formatClock(n.at)}
                >
                  {timeAgo(n.at, now(), locale())}
                </time>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="notes-foot">
        <span class="notes-help">{t("notes.help")}</span>
        <button class="btn" disabled={props.notes.length === 0} onClick={() => setConfirming(true)}>
          {t("notes.clear")}
        </button>
      </div>
      <Show when={confirming()}>
        <ConfirmDialog
          title={t("notes.clearTitle")}
          message={t("notes.clearMessage", { n: props.notes.length })}
          confirmLabel={t("notes.clearConfirm")}
          onConfirm={() => {
            setConfirming(false);
            props.onClear();
          }}
          onCancel={() => setConfirming(false)}
        />
      </Show>
    </section>
  );
}
