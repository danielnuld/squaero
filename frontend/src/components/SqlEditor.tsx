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
import { closeBrackets, autocompletion, completionKeymap } from "@codemirror/autocomplete";
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
  /** Reports whether the editor currently holds a non-empty selection, so the
      toolbar can offer "Ejecutar selección". */
  onSelectionChange?: (hasSelection: boolean) => void;
  /** Insert this text at the cursor when `tick` changes (snippets, issue #129). */
  insertRequest?: { text: string; tick: number };
  /** Table -> columns map that drives table/column autocomplete (issue #110). */
  schema?: Record<string, string[]>;
}) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  // Reconfigured when the completion schema OR the engine changes, so autocomplete
  // tracks the active connection without rebuilding the editor.
  const sqlConf = new Compartment();
  // The engine's dialect drives the identifier quote the completer applies: MySQL
  // must get backticks, since a `"`-quoted name is a string literal there.
  const sqlExt = () =>
    sql({ dialect: editorDialect(props.dialect), schema: props.schema ?? {} });
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

  // Run what the user means: the selection, else the statement under the cursor,
  // else the whole document (issue #130). Pure choice lives in runScope.ts.
  const runFromView = () => {
    if (!view) return;
    const { doc, selection } = view.state;
    const { from, to, head } = selection.main;
    const target = pickRunTarget(doc.toString(), from, to, head);
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
            indentWithTab,
            ...searchKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
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
    if (view) {
      view.dispatch({ effects: sqlConf.reconfigure(sql({ dialect, schema })) });
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
