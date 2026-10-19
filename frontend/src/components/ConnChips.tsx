import { Show } from "solid-js";
import { Icon } from "./icons";
import { t } from "../utils/i18n";
import type { SafeMode } from "../utils/safeMode";
import { ENV_DEFAULTS, type ConnEnv } from "../utils/connectionEnv";

/** The protection spelled out (R-06): a neutral chip with its icon and label,
    for lists with room for words — the welcome, the manager, the form preview. */
export function SafeChip(props: { mode?: SafeMode }) {
  return (
    <Show when={props.mode}>
      {(mode) => (
        <span class={`safe-chip safe-${mode()}`}>
          <Icon name={mode() === "readOnly" ? "lock" : "warning"} size={12} />
          {t(mode() === "readOnly" ? "safe.badgeReadOnly" : "safe.badgeConfirm")}
        </span>
      )}
    </Show>
  );
}

/** «Tipo de entorno» (R-06): a coloured dot and its name. */
export function EnvChip(props: { env?: ConnEnv }) {
  return (
    <Show when={props.env}>
      {(env) => (
        <span class={`env-chip env-${env()}`} style={{ "--conn-accent": ENV_DEFAULTS[env()].color }}>
          <span class="env-dot" aria-hidden="true" />
          {t(`env.${env()}`)}
        </span>
      )}
    </Show>
  );
}
