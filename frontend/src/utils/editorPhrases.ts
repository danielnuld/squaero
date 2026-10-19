// CodeMirror's own words in the UI's language (audit P4, rule 9). CodeMirror
// asks `EditorState.phrases` for each English string it shows — the find and
// replace panel, the fold gutter, the completion list's label — so the table
// maps those strings to catalog keys. And the «1 de 2» the find panel lacks.

import type { EditorState } from "@codemirror/state";
import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import { t } from "./i18n";

/** CodeMirror's English phrase → catalog key. */
export const CM_PHRASES: Record<string, string> = {
  Find: "cm.find",
  Replace: "cm.replace",
  next: "cm.next",
  previous: "cm.previous",
  all: "cm.all",
  "match case": "cm.matchCase",
  regexp: "cm.regexp",
  "by word": "cm.byWord",
  replace: "cm.replaceOne",
  "replace all": "cm.replaceAll",
  close: "cm.close",
  "current match": "cm.currentMatch",
  "replaced $ matches": "cm.replacedMatches",
  "replaced match on line $": "cm.replacedOnLine",
  "on line": "cm.onLine",
  "Go to line": "cm.goToLine",
  go: "cm.go",
  to: "cm.to",
  "Fold line": "cm.foldLine",
  "Unfold line": "cm.unfoldLine",
  "Folded lines": "cm.foldedLines",
  "Unfolded lines": "cm.unfoldedLines",
  "folded code": "cm.foldedCode",
  unfold: "cm.unfold",
  Completions: "cm.completions",
  "Control character": "cm.controlChar",
};

/** The phrases for `EditorState.phrases`, translated by `tr` (the catalog by default). */
export function editorPhrases(tr: (key: string) => string = t): Record<string, string> {
  return Object.fromEntries(Object.entries(CM_PHRASES).map(([en, key]) => [en, tr(key)]));
}

/** Counting stops here: a find over a huge script must not stall typing. */
export const MATCH_COUNT_CAP = 1000;

/**
 * Where the selection sits among the find panel's matches: `index` is 1-based
 * (0 when the selection is on none), `total` capped at MATCH_COUNT_CAP. Null
 * when the panel is closed or its query is empty or invalid.
 */
export function matchCount(state: EditorState): { index: number; total: number } | null {
  if (!searchPanelOpen(state)) return null;
  const query = getSearchQuery(state);
  if (!query.search || !query.valid) return null;
  const sel = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let index = 0;
  for (let r = cursor.next(); !r.done && total < MATCH_COUNT_CAP; r = cursor.next()) {
    total++;
    if (r.value.from === sel.from && r.value.to === sel.to) index = total;
  }
  return { index, total };
}

/** The count as the panel shows it: «1 de 2», «Sin resultados», «- de 1000+». */
export function matchCountText(count: { index: number; total: number }, tr: typeof t = t): string {
  if (count.total === 0) return tr("cm.noMatches");
  const total = count.total >= MATCH_COUNT_CAP ? `${MATCH_COUNT_CAP}+` : String(count.total);
  return tr("cm.matchOf", { index: count.index || "–", total });
}
