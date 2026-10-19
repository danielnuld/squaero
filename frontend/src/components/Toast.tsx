import { onCleanup, onMount, type JSX } from "solid-js";
import { Icon } from "./icons";
import { t } from "../utils/i18n";

// One toast (R-30, audit rule 10). An error is announced at once (role=alert)
// and stays until it is closed — it must never vanish before it is read
// (WCAG 2.2.1). Anything else is a polite status that may leave by itself
// after `autoHideMs`, waiting while the pointer rests on it.
export function Toast(props: {
  error?: boolean;
  /** Extra classes (`app-toast-run`…). */
  class?: string;
  /** Close by itself after this long; ignored for an error. */
  autoHideMs?: number;
  onClose: () => void;
  /** The text, then any action buttons. */
  children: JSX.Element;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    if (!props.error && props.autoHideMs) timer = setTimeout(() => props.onClose(), props.autoHideMs);
  };
  onMount(arm);
  onCleanup(() => clearTimeout(timer));
  return (
    <div
      class={`app-toast${props.error ? " app-toast-error" : ""}${props.class ? ` ${props.class}` : ""}`}
      role={props.error ? "alert" : "status"}
      onMouseEnter={() => clearTimeout(timer)}
      onMouseLeave={arm}
    >
      {props.children}
      <button class="app-toast-close" title={t("panel.close")} aria-label={t("panel.close")} onClick={() => props.onClose()}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
