// The CodeMirror binding of go to definition, find usages (issue #663) and
// rename (issue #664). The answers come from utils/sqlNavigation.ts; this only
// reads the editor, moves the selection, paints the usages and asks for names.
//
//   F12 / Mod+click      go to definition
//   Shift+F12 / Alt+F7   find usages (F3 / Shift+F3 step through them, Esc clears)
//   F2 / Shift+F6        rename

import { countText } from "../utils/confirmText";
import { keyLabel } from "../utils/shortcuts";
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, showDialog, type DecorationSet } from "@codemirror/view";
import { analyzeSql } from "../utils/sqlScope";
import type { EditorSchema } from "../utils/sqlEditor";
import {
  definitionAt,
  occurrencesOf,
  renameEdits,
  routineAt,
  symbolAt,
  symbolName,
  type RenameError,
} from "../utils/sqlNavigation";
import { t } from "../utils/i18n";

/** A database object the editor asks the app to show. */
export type ObjectTarget =
  | { kind: "table"; name: string }
  | { kind: "routine"; name: string; schema?: string };

export interface NavigationOptions {
  engine: () => string | undefined;
  /** Table -> columns, as the editor's completion gets it. */
  schema: () => Record<string, string[]> | undefined;
  /** Show a table/view or routine (its structure or DDL). */
  onObject?: (target: ObjectTarget) => void;
}

const setUsages = StateEffect.define<{ from: number; to: number }[] | null>();
const usageMark = Decoration.mark({ class: "cm-usage" });

const usagesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setUsages)) deco = e.value ? Decoration.set(e.value.map((r) => usageMark.range(r.from, r.to))) : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const usageTheme = EditorView.baseTheme({
  ".cm-usage": { backgroundColor: "color-mix(in srgb, var(--accent, #3b82f6) 28%, transparent)", borderRadius: "2px" },
});

/** Columns not described yet arrive as `[]`; to the scope pass that would be
    "a table with no columns", so only the described ones are passed on. */
function editorSchema(map: Record<string, string[]> | undefined): EditorSchema {
  const m = map ?? {};
  return {
    tables: Object.keys(m),
    columns: Object.fromEntries(Object.entries(m).filter(([, cols]) => cols.length > 0)),
  };
}

const RENAME_ERRORS: Record<RenameError, string> = {
  "no-symbol": "editor.rename.noSymbol",
  empty: "editor.rename.empty",
  invalid: "editor.rename.invalid",
  "needs-quotes": "editor.rename.needsQuotes",
  conflict: "editor.rename.conflict",
};

export function sqlNavigation(opts: NavigationOptions) {
  const analyze = (view: EditorView) =>
    analyzeSql(view.state.doc.toString(), { engine: opts.engine(), schema: editorSchema(opts.schema()) });
  const head = (view: EditorView) => view.state.selection.main.head;
  let closeUsages: StateEffect<unknown> | null = null;

  /** Go to what the identifier at `pos` names. False when it names nothing. */
  const goToDefinition = (view: EditorView, pos = head(view)): boolean => {
    const def = definitionAt(analyze(view), pos);
    if (def?.kind === "range") {
      view.dispatch({ selection: { anchor: def.range.start, head: def.range.end }, scrollIntoView: true });
      view.focus();
      return true;
    }
    if (def?.kind === "object") {
      opts.onObject?.({ kind: "table", name: def.name });
      return true;
    }
    const routine = routineAt(view.state.doc.toString(), pos, opts.engine());
    if (routine) {
      opts.onObject?.({ kind: "routine", ...routine });
      return true;
    }
    return false;
  };

  const clearUsages = (view: EditorView): boolean => {
    if (!closeUsages) return false;
    const close = closeUsages;
    closeUsages = null;
    view.dispatch({ effects: [setUsages.of(null), close] });
    return true;
  };

  /** Move to the next (or previous) usage after the cursor, wrapping around. */
  const stepUsage = (view: EditorView, dir: 1 | -1): boolean => {
    const ranges: { from: number; to: number }[] = [];
    view.state.field(usagesField).between(0, view.state.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
    if (ranges.length === 0) return false;
    const at = head(view);
    const next =
      dir === 1
        ? (ranges.find((r) => r.from > at) ?? ranges[0])
        : ([...ranges].reverse().find((r) => r.to < at) ?? ranges[ranges.length - 1]);
    view.dispatch({ selection: { anchor: next.from, head: next.to }, scrollIntoView: true });
    return true;
  };

  /** Paint every occurrence of the symbol at `pos` and offer to step through them. */
  const findUsages = (view: EditorView, pos = head(view)): boolean => {
    const analysis = analyze(view);
    const sym = symbolAt(analysis, pos);
    if (!sym) return false;
    const ranges = occurrencesOf(analysis, sym).map((r) => ({ from: r.start, to: r.end }));
    clearUsages(view);
    view.dispatch({ effects: setUsages.of(ranges) });
    const { close, result } = showDialog(view, {
      class: "cm-usages",
      content: (v) => {
        const form = document.createElement("form");
        const text = document.createElement("span");
        text.textContent = countText("editor.usages.count", ranges.length, { name: symbolName(sym), back: keyLabel("Shift+F3") });
        const button = (label: string, dir: 1 | -1) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "cm-button";
          b.textContent = label;
          b.onclick = () => stepUsage(v, dir);
          return b;
        };
        // The dialog adds its own close button; Escape closes it too.
        form.append(text, " ", button(t("editor.usages.prev"), -1), " ", button(t("editor.usages.next"), 1));
        return form;
      },
    });
    closeUsages = close;
    void result.then(() => {
      if (closeUsages !== close) return;
      closeUsages = null;
      view.dispatch({ effects: setUsages.of(null) });
    });
    return true;
  };

  /** Ask for a new name for the symbol at `pos` and rename it in one transaction. */
  const rename = (view: EditorView, pos = head(view)): boolean => {
    const before = view.state.doc;
    const analysis = analyze(view);
    const sym = symbolAt(analysis, pos);
    if (!sym) return false;
    const ask = (value: string, error?: RenameError) => {
      const label = t("editor.rename.label", { name: symbolName(sym) });
      const { close, result } = showDialog(view, {
        class: "cm-rename",
        label: error ? `${t(RENAME_ERRORS[error])} ${label}` : label,
        input: { name: "name", value, "aria-label": t("editor.rename.title") },
        submitLabel: t("editor.rename.submit"),
        focus: true,
      });
      void result.then((form) => {
        if (!form) return;
        const input = form.elements.namedItem("name") as HTMLInputElement | null;
        const name = input?.value ?? "";
        // The text moved under the dialog: the offsets no longer hold.
        if (view.state.doc !== before) return;
        const res = renameEdits(before.toString(), analysis, pos, name, opts.engine());
        if ("error" in res) {
          ask(name, res.error);
          return;
        }
        view.dispatch({ changes: res.changes, effects: close, userEvent: "rename" });
        view.focus();
      });
    };
    ask(symbolName(sym));
    return true;
  };

  /** What the menu can offer at `pos`. */
  const available = (view: EditorView, pos: number) => {
    const analysis = analyze(view);
    const symbol = symbolAt(analysis, pos) !== null;
    return {
      definition: definitionAt(analysis, pos) !== null || routineAt(view.state.doc.toString(), pos, opts.engine()) !== null,
      symbol,
    };
  };

  const extension: Extension = [
    usagesField,
    usageTheme,
    Prec.high(
      keymap.of([
        { key: "F12", preventDefault: true, run: (v) => (goToDefinition(v), true) },
        { key: "Shift-F12", preventDefault: true, run: (v) => (findUsages(v), true) },
        { key: "Alt-F7", preventDefault: true, run: (v) => (findUsages(v), true) },
        { key: "F2", preventDefault: true, run: (v) => (rename(v), true) },
        { key: "Shift-F6", preventDefault: true, run: (v) => (rename(v), true) },
        // Only while usages are painted; otherwise they stay the find panel's.
        { key: "F3", run: (v) => stepUsage(v, 1) },
        { key: "Shift-F3", run: (v) => stepUsage(v, -1) },
        { key: "Escape", run: clearUsages },
      ]),
    ),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null || !goToDefinition(view, pos)) return false;
        e.preventDefault();
        return true;
      },
    }),
  ];

  return { extension, goToDefinition, findUsages, rename, available };
}
