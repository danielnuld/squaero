// The one wizard pattern (issue #692): the pure half. A wizard is numbered steps
// — «1 Origen › 2 Columnas › 3 Importar» — where the ones behind are done, one
// is current and the rest wait; the footer always reads [Atrás] … [primary]
// [Cancelar]. Components/Wizard.tsx draws it.

export type StepState = "done" | "current" | "todo";

/** The state of each of `count` steps when `current` (0-based) is on screen. */
export function stepStates(count: number, current: number): StepState[] {
  return Array.from({ length: count }, (_, i) => (i < current ? "done" : i === current ? "current" : "todo"));
}
