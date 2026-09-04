import { onCleanup, onMount, createEffect } from "solid-js";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { sql } from "@codemirror/lang-sql";
import {
  acceptCompletion,
  closeBrackets,
  autocompletion,
  completionKeymap,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from "@codemirror/search";
import { formatSql } from "../utils/sqlFormat";
import { editorDialect } from "../utils/sqlDialect";
import { pickRunTarget, type RunScope } from "../utils/runScope";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { copyText } from "../utils/rowCopy";
import { t } from "../utils/i18n";

// CodeMirror 6 SQL editor. A single EditorView is reused across query tabs; the
// active tab's text is swapped in on tab change. Ctrl/Cmd+Enter runs the query
// and Ctrl/Cmd+Shift+F formats it (Mod = Cmd on macOS, Ctrl elsewhere). Pure
// tab/state logic lives in src/utils/tabs.ts and the formatter in
// src/utils/sqlFormat.ts — this component is the thin CodeMirror binding.
export function SqlEditor(props: {
  /** Id of the tab currently shown. */
  activeId: number;
  /** Stored SQL for a given tab, used when its text is first loaded. */
  sqlFor: (id: number) => string;
  /** Fired on every edit so the workspace can persist the tab's text. */
  onChange: (id: number, sql: string) => void;
  /** Fired on Ctrl/Cmd+Enter. Runs the selection, else the statement under the
      cursor, else the whole document (issue #130); `scope` says which. */
  onRun: (sql: string, scope?: RunScope) => void;
  /** Fired on Ctrl/Cmd+Shift+E to show the query plan (EXPLAIN, issue #131). */
  onExplain?: () => void;
  /** Active engine name, used to pick the SQL dialect when formatting. */
  dialect?: string;
  /** Bumping this number requests a format of the current document. */
  formatTick?: number;
  /** Bumping this number opens the find panel (Ctrl/Cmd+F, issue: editor find). */
  searchTick?: number;
  /** Bumping this number runs the query from the toolbar, exactly as
      Ctrl/Cmd+Enter does: the selection, else the statement under the cursor,
      else the whole document. */
  runTick?: number;
  /** Bumping this number asks for the text to save as a snippet (issue #320).
      Resolved exactly like a run — selection, else the statement under the
      cursor, else the whole document — so "you save what you would run". */
  saveTick?: number;
  /** Answers a saveTick with the resolved text and the scope it came from. */
  onSaveRequest?: (sql: string, scope: RunScope) => void;
  /** Reports whether the editor currently holds a non-empty selection, so the
      toolbar can offer "Ejecutar selección". */
  onSelectionChange?: (hasSelection: boolean) => void;
  /** Insert this text at the cursor when `tick` changes (snippets, issue #129). */
  insertRequest?: { text: string; tick: number };
  /** Table -> columns map that drives table/column autocomplete (issue #110). */
  schema?: Record<string, string[]>;
  /**
   * The table whose columns can be suggested WITHOUT qualifying them.
   *
   * lang-sql only offers a column name unqualified when it knows which table is
   * meant; with the schema alone, `WHERE nom…` completed keywords and nothing else,
   * while `e2e_items.nom…` completed correctly. This is the table the statement being
   * written reads from.
   */
  defaultTable?: string;
}) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  // Reconfigured when the completion schema OR the engine changes, so autocomplete
  // tracks the active connection without rebuilding the editor.
  const sqlConf = new Compartment();
  // The engine's dialect drives the identifier quote the completer applies: MySQL
  // must get backticks, since a `"`-quoted name is a string literal there.
  const sqlExt = () =>
    sql({
      dialect: editorDialect(props.dialect),
      schema: props.schema ?? {},
      defaultTable: props.defaultTable,
    });
  // Which tab's text is loaded in the view; guards the change listener while we
  // programmatically swap documents on tab switch. Set on mount to match the
  // doc actually loaded into the view.
  let loaded = props.activeId;
  let swapping = false;

  // Reformat the current document in place, replacing its text and persisting
  // the result. A no-op when the formatter leaves the text unchanged (empty
  // input, non-SQL engine, or a parse error — see sqlFormat.ts).
  const doFormat = () => {
    if (!view) return;
    const src = view.state.doc.toString();
    const out = formatSql(src, props.dialect);
    if (out === src) return;
    swapping = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: out } });
    swapping = false;
    props.onChange(loaded, out);
  };

  // Run what the user means: the selection, else everything in the editor
  // (issue #130). Pure choice lives in runScope.ts.
  const runFromView = () => {
    if (!view) return;
    const { doc, selection } = view.state;
    const { from, to } = selection.main;
    const target = pickRunTarget(doc.toString(), from, to);
    props.onRun(target.text, target.scope);
  };

  onMount(() => {
    loaded = props.activeId;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.sqlFor(props.activeId),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          autocompletion(),
          // In-editor find/replace (Ctrl/Cmd+F). The panel sits at the top and
          // matches are highlighted; searchKeymap adds find-next/prev + replace.
          search({ top: true }),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          sqlConf.of(sqlExt()),
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: () => {
                runFromView();
                return true;
              },
            },
            {
              key: "Mod-Shift-f",
              preventDefault: true,
              run: () => {
                doFormat();
                return true;
              },
            },
            {
              key: "Mod-Shift-e",
              preventDefault: true,
              run: () => {
                props.onExplain?.();
                return true;
              },
            },
            // Tab accepts the open suggestion, as every code editor does.
            // acceptCompletion returns false when no list is open, so Tab still
            // falls through to indentWithTab the rest of the time.
            { key: "Tab", run: acceptCompletion },
            indentWithTab,
            ...searchKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          // Name the editable surface. CodeMirror's content is a contenteditable
          // with the textbox role, and without a name it was indistinguishable from
          // the object filter to anything asking by role — a screen reader included.
          EditorView.contentAttributes.of({ "aria-label": t("editor.ariaLabel") }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !swapping) {
              props.onChange(loaded, view!.state.doc.toString());
            }
            // Keep the toolbar's Run button in sync with the selection so it can
            // read "Ejecutar selección" when text is highlighted.
            if ((u.selectionSet || u.docChanged) && props.onSelectionChange) {
              props.onSelectionChange(!u.state.selection.main.empty);
            }
          }),
        ],
      }),
    });
  });

  // Swap the document when the active tab changes (tracks activeId only; the
  // early return keeps keystroke-driven sql updates from resetting the doc).
  createEffect(() => {
    const id = props.activeId;
    if (!view || id === loaded) {
      return;
    }
    loaded = id;
    swapping = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: props.sqlFor(id) },
    });
    swapping = false;
  });

  // Reconfigure autocomplete when the schema map or the engine changes (both
  // happen on a connection switch or refresh). Guarded until the view exists.
  createEffect(() => {
    const schema = props.schema ?? {};
    const dialect = editorDialect(props.dialect);
    const defaultTable = props.defaultTable;
    if (!view) return;
    view.dispatch({
      effects: sqlConf.reconfigure(sql({ dialect, schema, defaultTable })),
    });
    // Columns arrive asynchronously — they are fetched for the table the statement
    // mentions, which is only known once it is written. Anything computed before
    // they landed is stale: an open popup keeps showing the old list, and a popup
    // that closed because nothing matched stays closed. Either way the user would
    // have to type another character to discover the columns exist.
    //
    // So recompute whenever the editor is the focused element, which means the user
    // is writing the very statement these columns belong to. A suggestion list
    // appearing there is expected; it is not opened behind their back elsewhere.
    if (completionStatus(view.state) !== null || view.hasFocus) {
      startCompletion(view);
    }
  });

  // External format requests (the toolbar button) arrive as a bumped counter.
  let lastFormatTick = props.formatTick ?? 0;
  createEffect(() => {
    const tick = props.formatTick ?? 0;
    if (tick !== lastFormatTick) {
      lastFormatTick = tick;
      doFormat();
    }
  });

  // Toolbar Run requests arrive as a bumped counter and run exactly what
  // Ctrl/Cmd+Enter would (selection / statement / document). The editor keeps its
  // selection when focus moves to the button, so runFromView still sees it.
  let lastRunTick = props.runTick ?? 0;
  createEffect(() => {
    const tick = props.runTick ?? 0;
    if (tick === lastRunTick) return;
    lastRunTick = tick;
    runFromView();
  });

  // Save-as-snippet requests arrive the same way, and resolve the same target as
  // a run: the user saves exactly what they would execute (issue #320).
  let lastSaveTick = props.saveTick ?? 0;
  createEffect(() => {
    const tick = props.saveTick ?? 0;
    if (tick === lastSaveTick) return;
    lastSaveTick = tick;
    if (!view) return;
    const { doc, selection } = view.state;
    const { from, to } = selection.main;
    const target = pickRunTarget(doc.toString(), from, to);
    props.onSaveRequest?.(target.text, target.scope);
  });

  // Find requests (Ctrl/Cmd+F) arrive as a bumped counter: focus the editor and
  // open CodeMirror's search panel (idempotent — reopening just refocuses it).
  let lastSearchTick = props.searchTick ?? 0;
  createEffect(() => {
    const tick = props.searchTick ?? 0;
    if (!view || tick === lastSearchTick) return;
    lastSearchTick = tick;
    view.focus();
    openSearchPanel(view);
  });

  // Snippet insertions (issue #129) arrive as a bumped tick; drop the text in at
  // the current selection, place the cursor after it, and persist.
  let lastInsertTick = props.insertRequest?.tick ?? 0;
  createEffect(() => {
    const req = props.insertRequest;
    if (!view || !req || req.tick === lastInsertTick) return;
    lastInsertTick = req.tick;
    const { from, to } = view.state.selection.main;
    swapping = true;
    view.dispatch({
      changes: { from, to, insert: req.text },
      selection: { anchor: from + req.text.length },
    });
    swapping = false;
    props.onChange(loaded, view.state.doc.toString());
    view.focus();
  });

  onCleanup(() => view?.destroy());

  // Right-click menu: format / run / select-all / copy, all operating on the
  // live editor. Copy uses the current selection, or the whole document when
  // nothing is selected.
  const editorMenu = (): MenuItem[] => {
    const v = view;
    const hasText = (v?.state.doc.length ?? 0) > 0;
    const hasSelection = v ? !v.state.selection.main.empty : false;
    const selectAll = () => {
      if (!v) return;
      v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
      v.focus();
    };
    const copy = () => {
      if (!v) return;
      const { from, to } = v.state.selection.main;
      const text = from === to ? v.state.doc.toString() : v.state.sliceDoc(from, to);
      copyText(text);
    };
    return [
      { label: t("editor.format"), action: doFormat, disabled: !hasText },
      {
        label: hasSelection ? t("editor.runSelection") : t("editor.run"),
        action: runFromView,
        disabled: !hasText,
      },
      { separator: true },
      { label: t("editor.selectAll"), action: selectAll, disabled: !hasText },
      { label: t("editor.copy"), action: copy, disabled: !hasText },
    ];
  };

  return (
    <div class="editor" ref={host} onContextMenu={(e) => openContextMenu(e, editorMenu())} />
  );
}
