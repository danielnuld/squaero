// The one wizard pattern (issue #692): the pure half. A wizard is numbered steps
// — «1 Origen › 2 Columnas › 3 Importar» — where the ones behind are done, one
// is current and the rest wait; the footer always reads [Atrás] … [primary]
// [Cancelar]. Components/Wizard.tsx draws it.

import { t } from "./i18n";

export type StepState = "done" | "current" | "todo";

/** The state of each of `count` steps when `current` (0-based) is on screen. */
export function stepStates(count: number, current: number): StepState[] {
  return Array.from({ length: count }, (_, i) => (i < current ? "done" : i === current ? "current" : "todo"));
}

/** A connection a wizard writes to: read-only ones are offered, marked, and
    only get the script (audit P1) — the transport would refuse the writes. */
export function isReadOnlyTarget(c: { safeMode?: string } | undefined): boolean {
  return c?.safeMode === "readOnly";
}

/** The target dropdown's options, read-only connections marked as such. */
export function targetOptions(
  conns: readonly { id: string; name: string; safeMode?: string }[],
): { value: string; label: string }[] {
  return conns.map((c) => ({
    value: c.id,
    label: isReadOnlyTarget(c) ? t("wiz.readOnlyOption", { name: c.name }) : c.name,
  }));
}
