// The keys of in-place cell editing (issue #690, R-14, A-12). Pure: the grid
// asks what a key press means and does it. Two places listen:
//
// - the grid surface, with a cell selected and no editor open: F2 and Enter
//   open the editor, a printable key opens it with that character typed,
//   Space opens the row detail, Mod+Shift+N writes a NULL, Alt+↓ opens the
//   foreign-key browser;
// - the cell's editor: Enter confirms and moves down (Shift+Enter up), Tab
//   moves right (Shift+Tab left), Esc puts back the value the cell had when
//   the editor opened, Mod+Shift+N writes a NULL.

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export type GridEditAction =
  | { kind: "edit" }
  | { kind: "type"; text: string }
  | { kind: "null" }
  | { kind: "detail" }
  | { kind: "fk" };

const mod = (e: KeyLike) => !!(e.ctrlKey || e.metaKey);

const isSetNull = (e: KeyLike) => mod(e) && !!e.shiftKey && !e.altKey && e.key.toLowerCase() === "n";

/** What a key on the grid surface does for editing, or null for none. */
export function gridEditKey(e: KeyLike): GridEditAction | null {
  if (isSetNull(e)) return { kind: "null" };
  if (e.altKey && !mod(e) && e.key === "ArrowDown") return { kind: "fk" };
  if (mod(e) || e.altKey) return null;
  if (e.key === "F2" || (e.key === "Enter" && !e.shiftKey)) return { kind: "edit" };
  if (e.key === " ") return { kind: "detail" };
  // One character: a letter, a digit, a sign. Named keys (Tab, Delete, F5…)
  // are longer than one character, so they never start an edit.
  if ([...e.key].length === 1) return { kind: "type", text: e.key };
  return null;
}

export type EditorAction =
  | { kind: "commit"; move: "ArrowDown" | "ArrowUp" | "ArrowRight" | "ArrowLeft" }
  | { kind: "revert" }
  | { kind: "null" };

/** What a key inside the cell editor does, or null to let the input have it. */
export function cellEditorKey(e: KeyLike): EditorAction | null {
  if (isSetNull(e)) return { kind: "null" };
  if (mod(e) || e.altKey) return null;
  if (e.key === "Enter") return { kind: "commit", move: e.shiftKey ? "ArrowUp" : "ArrowDown" };
  if (e.key === "Tab") return { kind: "commit", move: e.shiftKey ? "ArrowLeft" : "ArrowRight" };
  if (e.key === "Escape") return { kind: "revert" };
  return null;
}
