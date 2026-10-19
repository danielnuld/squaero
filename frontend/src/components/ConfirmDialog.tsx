import { Show, createSignal, type JSX } from "solid-js";
import { t } from "../utils/i18n";
import { typedNameMatches } from "../utils/dialog";
import { Dialog } from "./Dialog";
import { copyText } from "../utils/rowCopy";

// The destructive confirmation (issues #177, #692): the shared Dialog with a red
// button that says what it does («Eliminar tabla», «Eliminar 3 filas»), the
// exact SQL that will run, and — on a protected target — a box where the name
// has to be typed before the button wakes up (audit A-25, R-08). Focus starts on
// Cancel and Enter never confirms. While `busy` the buttons are disabled and the
// dialog stays open, so a failed action shows its error and can be retried.
export function ConfirmDialog(props: {
  title?: string;
  message: string;
  /** The exact SQL that will run, shown verbatim. */
  sql?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** While true, buttons are disabled and the dialog stays open (in-flight op). */
  busy?: boolean;
  /** An error from the attempted action, shown in the dialog so it can be retried. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** An optional third, non-destructive choice (e.g. Commit beside Rollback, #667). */
  altLabel?: string;
  onAlt?: () => void;
  /** Given, the confirm button stays disabled until this exact text is typed. */
  typeToConfirm?: string;
  /** Offer «Copiar SQL» beside the buttons (audit A-25). */
  copySql?: boolean;
  /** Extra content between the message and the SQL (e.g. a field to fill in). */
  children?: JSX.Element;
}) {
  const [typed, setTyped] = createSignal("");
  const locked = () => !!props.typeToConfirm && !typedNameMatches(typed(), props.typeToConfirm);

  return (
    <Dialog
      title={props.title ?? t("confirm.title")}
      size="md"
      class="confirm-dialog"
      busy={props.busy}
      error={props.error}
      onCancel={props.onCancel}
      cancelLabel={props.cancelLabel}
      primary={{
        label: props.confirmLabel ?? t("common.delete"),
        onClick: () => {
          if (!locked()) props.onConfirm();
        },
        disabled: locked(),
        danger: true,
      }}
      helpers={
        <>
          <Show when={props.copySql && props.sql}>
            <button type="button" class="btn" onClick={() => copyText(props.sql ?? "")}>
              {t("confirm.copySql")}
            </button>
          </Show>
          <Show when={props.onAlt}>
            <button type="button" class="btn" disabled={props.busy} onClick={() => props.onAlt?.()}>
              {props.altLabel}
            </button>
          </Show>
        </>
      }
    >
      <p class="confirm-message">{props.message}</p>
      {props.children}
      <Show when={props.sql}>
        <pre class="ddl-text">{props.sql}</pre>
      </Show>
      <Show when={props.typeToConfirm}>
        {(name) => (
          <label class="dlg-field">
            <span>{t("confirm.typeName", { name: name() })}</span>
            <input
              class="td-in"
              type="text"
              data-autofocus
              autocomplete="off"
              spellcheck={false}
              value={typed()}
              onInput={(e) => setTyped(e.currentTarget.value)}
            />
          </label>
        )}
      </Show>
    </Dialog>
  );
}
