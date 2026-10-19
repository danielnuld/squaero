import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { t, locale } from "../utils/i18n";
import { timeAgo } from "../utils/history";
import { formatClock } from "../utils/duration";
import { notesByDay, type Note, type NoteAction, type NoteDay, type NoteLevel } from "../utils/notifications";
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
//
// M14 Notifications: grouped by day (Hoy, Ayer, then the date), each with its
// title and detail, the ones that arrived since the last look marked until
// «Marcar como leídas», and the action a note offers (Reintentar, Ver resultado).
export function Notifications(props: {
  notes: readonly Note[];
  onClear: () => void;
  onClose: () => void;
  /** Notes after this instant were unread when the panel opened. */
  unreadSince?: number;
  onMarkRead?: () => void;
  /** Carries out a note's action; absent, no action is offered. */
  onAction?: (action: NoteAction) => void;
  /** Whether an action can still be done (the tab of «Ver resultado» exists). */
  canAct?: (action: NoteAction) => boolean;
  /** Injected in tests; Date.now otherwise. */
  now?: () => number;
}) {
  const [confirming, setConfirming] = createSignal(false);
  let box: HTMLElement | undefined;
  const now = () => (props.now ?? Date.now)();
  const unread = (n: Note) => props.unreadSince !== undefined && n.at > props.unreadSince;
  const dayName = (d: NoteDay) =>
    d.kind === "date"
      ? new Date(d.at).toLocaleDateString(locale(), { day: "numeric", month: "long" })
      : t(`notes.day.${d.kind}`);

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
        <Show when={props.onMarkRead && props.notes.some(unread)}>
          <button class="edit-btn" onClick={() => props.onMarkRead?.()}>
            {t("notes.markRead")}
          </button>
        </Show>
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
        <div class="notes-list" role="list" aria-label={t("notes.title")}>
          <For each={notesByDay(props.notes, now())}>
            {(g) => (
              <>
                <div class="notes-day" role="presentation">
                  {dayName(g.day)}
                </div>
                <For each={g.notes}>
                  {(n) => (
                    <div
                      class={`notes-item level-${n.level}`}
                      classList={{ "is-unread": unread(n) }}
                      role="listitem"
                    >
                      <span class="notes-icon" aria-label={t(`notes.level.${n.level}`)} role="img">
                        <Icon name={LEVEL_ICON[n.level]} size={14} />
                      </span>
                      <div class="notes-body">
                        <div class="notes-line">
                          <span class="notes-text">{n.title ?? n.text}</span>
                          <time
                            class="notes-time"
                            dateTime={new Date(n.at).toISOString()}
                            title={formatClock(n.at)}
                          >
                            {timeAgo(n.at, now(), locale())}
                          </time>
                        </div>
                        <Show when={n.detail}>
                          <div class="notes-detail">{n.detail}</div>
                        </Show>
                        <Show when={n.action && props.onAction ? n.action : undefined}>
                          {(a) => (
                            <button
                              class="edit-btn notes-action"
                              disabled={props.canAct ? !props.canAct(a()) : false}
                              title={
                                props.canAct && !props.canAct(a()) ? t(`notes.actionGone.${a().kind}`) : undefined
                              }
                              onClick={() => props.onAction?.(a())}
                            >
                              {t(`notes.action.${a().kind}`)}
                            </button>
                          )}
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
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
