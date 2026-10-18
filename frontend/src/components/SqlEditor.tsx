import { onCleanup, onMount, createEffect, createMemo } from "solid-js";
import { EditorState, Compartment, StateEffect, StateField, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { sql } from "@codemirror/lang-sql";
import {
  acceptCompletion,
  closeBrackets,
  autocompletion,
  completionKeymap,
  completionStatus,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  snippet,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from "@codemirror/search";
import { formatSql } from "../utils/sqlFormat";
import { editorDialect } from "../utils/sqlDialect";
import { pickRunTarget, type RunScope } from "../utils/runScope";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { copyText } from "../utils/rowCopy";
import { t } from "../utils/i18n";
import { editorSchema } from "../utils/sqlEditor";
import { sqlCompletions, type Completions } from "../utils/sqlComplete";
import { sqlDiagnostics, type SqlDiagnostic } from "../utils/sqlDiagnostics";
import type { ForeignKeyRelation } from "../utils/foreignKeys";
import { sqlNavigation, type ObjectTarget } from "./editorNavigation";
import { templateAt, templateToSnippet, type SqlTemplate } from "../utils/sqlTemplates";

/**
 * SQL colouring in the app's own palette (issue #473, tokens in #680).
 *
 * It used to be CodeMirror's `defaultHighlightStyle`, a fixed set of colours
 * designed for a light page — dark blue keywords on a near-black editor. It was
 * already wrong on the dark theme and it stayed exactly as wrong under every new
 * one, because it knew nothing about them.
 *
 * Each role reads its own `--syntax-*` token, which every theme defines (see
 * themeSchema.ts), so this follows any theme, present or future, with nothing to
 * keep in sync. CodeMirror emits these as plain CSS rules, so `var()` resolves
 * against the root like everywhere else, and the tokens inherit the contrast
 * the palette was validated for.
 */
const sqlHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool], color: "var(--syntax-number)" },
  { tag: tags.null, color: "var(--syntax-null)", fontStyle: "italic" },
  { tag: [tags.lineComment, tags.blockComment], color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: "var(--syntax-operator)" },
  { tag: [tags.typeName, tags.standard(tags.name)], color: "var(--syntax-type)" },
  { tag: tags.function(tags.variableName), color: "var(--syntax-type)" },
  { tag: [tags.variableName, tags.propertyName], color: "var(--syntax-name)" },
  { tag: tags.invalid, color: "var(--syntax-invalid)" },
]);

// Diagnostics (issue #662): squiggles under what sqlDiagnostics finds, with the
// message on hover. Built from view primitives rather than @codemirror/lint —
// a mark decoration and a hover tooltip are all it needs.
const setDiagnostics = StateEffect.define<DecorationSet>();
const diagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const e of tr.effects) if (e.is(setDiagnostics)) marks = e.value;
    return marks;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const diagnosticMarks = (list: SqlDiagnostic[], length: number): DecorationSet =>
  Decoration.set(
    list
      .filter((d) => d.from < d.to && d.to <= length)
      .map((d) => Decoration.mark({ class: `cm-diag cm-diag-${d.severity}`, diagnostic: d }).range(d.from, d.to)),
    true,
  );
const diagnosticHover = hoverTooltip((view, pos) => {
  const found: SqlDiagnostic[] = [];
  let start = pos;
  let end = pos;
  view.state.field(diagnosticsField).between(pos, pos, (from, to, mark) => {
    found.push(mark.spec.diagnostic as SqlDiagnostic);
    start = Math.min(start, from);
    end = Math.max(end, to);
  });
  if (found.length === 0) return null;
  return {
    pos: start,
    end,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-diag-tooltip";
      for (const d of found) {
        const line = document.createElement("div");
        line.className = `cm-diag-message cm-diag-${d.severity}`;
        line.textContent = t(d.messageKey, d.params);
        dom.appendChild(line);
      }
      return { dom };
    },
  };
});

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
  /** Real foreign keys of the tables the statement names: JOIN … ON completes
      the condition from them (issue #661). */
  foreignKeys?: ForeignKeyRelation[];
  /** Tables (lower case) the app tried to describe and found missing. Only these
      are marked as unknown: the table list is just what the tree has loaded. */
  missingTables?: string[];
  /** Mark problems in the SQL (issue #662). On unless false. */
  diagnostics?: boolean;
  /** Go to definition on a table/view or routine (issue #663): show it. */
  onGoToObject?: (target: ObjectTarget) => void;
  /** Templates in force (issue #665): an abbreviation + Tab, or picking it from
      the completion list, expands it with Tab-navigable placeholders. */
  templates?: SqlTemplate[];
  /** Opens this tab's local history (issue #674); the menu offers it when given. */
  onLocalHistory?: () => void;
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
  // Go to definition, find usages and rename (issues #663, #664).
  const nav = sqlNavigation({
    engine: () => props.dialect,
    schema: () => props.schema,
    onObject: (target) => props.onGoToObject?.(target),
  });

  const schemaNow = createMemo(() => editorSchema(props.schema ?? {}));

  // Contextual completion (issue #661) first; lang-sql's own sources (schema +
  // keywords, registered by sql() as language data) only where it has nothing.
  // Memoized per position: the fallbacks ask the same question again.
  let lastAsk:
    | { doc: Text; pos: number; explicit: boolean; schema: unknown; fks: unknown; out: Completions | null }
    | undefined;
  const semantic = (ctx: CompletionContext): Completions | null => {
    const schema = schemaNow();
    const fks = props.foreignKeys;
    const a = lastAsk;
    if (!a || a.doc !== ctx.state.doc || a.pos !== ctx.pos || a.explicit !== ctx.explicit || a.schema !== schema || a.fks !== fks) {
      const out = sqlCompletions(ctx.state.doc.toString(), ctx.pos, {
        schema,
        engine: props.dialect,
        foreignKeys: fks,
        explicit: ctx.explicit,
      });
      lastAsk = { doc: ctx.state.doc, pos: ctx.pos, explicit: ctx.explicit, schema, fks, out };
    }
    return lastAsk!.out;
  };
  const semanticSource: CompletionSource = (ctx) => {
    const r = semantic(ctx);
    return r && ({ ...r, validFor: /^[\p{L}\p{N}_$]*$/u } as CompletionResult);
  };
  const fallbackSource = (i: number): CompletionSource => (ctx) => {
    if (semantic(ctx)) return null;
    const src = ctx.state.languageDataAt<CompletionSource>("autocomplete", ctx.pos)[i];
    return typeof src === "function" ? src(ctx) : null;
  };

  // Diagnostics run once typing settles, and again when the schema they read
  // changes. Never on every keystroke: the marks just map along with the edit.
  let diagTimer: ReturnType<typeof setTimeout> | undefined;
  const runDiagnostics = () => {
    if (!view) return;
    const doc = view.state.doc.toString();
    const list =
      props.diagnostics === false
        ? []
        : sqlDiagnostics(doc, {
            schema: schemaNow(),
            engine: props.dialect,
            missingTables: new Set(props.missingTables ?? []),
          });
    view.dispatch({ effects: setDiagnostics.of(diagnosticMarks(list, doc.length)) });
  };
  const scheduleDiagnostics = () => {
    clearTimeout(diagTimer);
    diagTimer = setTimeout(runDiagnostics, 300);
  };

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

  // Templates (issue #665). Both read props.templates when called, so edits to
  // the snippet list or the settings apply without reconfiguring the editor.
  // Tab expands the abbreviation just typed at the main cursor.
  const expandTemplate = (v: EditorView): boolean => {
    const { main } = v.state.selection;
    if (!main.empty) return false;
    const line = v.state.doc.lineAt(main.head);
    const hit = templateAt(props.templates ?? [], line.text, main.head - line.from);
    if (!hit) return false;
    snippet(templateToSnippet(hit.template.body))(v, null, line.from + hit.from, main.head);
    return true;
  };
  // The completion list offers every template; one whose abbreviation is the
  // word typed in full is boosted to the top, so Tab on an open list expands it
  // rather than accepting a keyword that merely starts the same.
  const templateSource = (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    const list = props.templates ?? [];
    if (!list.length || (!word && !ctx.explicit)) return null;
    if (word && ctx.state.sliceDoc(word.from - 1, word.from) === ".") return null;
    const typed = word?.text.toLowerCase();
    return {
      from: word?.from ?? ctx.pos,
      options: list.map((tpl) =>
        snippetCompletion(templateToSnippet(tpl.body), {
          label: tpl.abbr,
          detail: `${t("editor.template")} · ${tpl.name}`,
          info: tpl.body,
          type: "text",
          boost: tpl.abbr === typed ? 99 : 0,
        }),
      ),
    };
  };

  // Run what the user means: the selection, else everything in the editor
  // (issue #130). Pure choice lives in runScope.ts. With several selections
  // (multicursor, issue #665) it is the MAIN one that runs, saves or is copied
  // — the last added — never a concatenation of them.
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
          // Multicursor (issue #665): Ctrl/Cmd+click adds a cursor, Alt+drag
          // selects a rectangle (the crosshair shows while Alt is held). The
          // keys come with the keymaps below: Mod-d / Mod-Shift-l (searchKeymap)
          // and Mod-Alt-ArrowUp/Down (defaultKeymap). Escape collapses to one.
          EditorState.allowMultipleSelections.of(true),
          rectangularSelection(),
          crosshairCursor(),
          history(),
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          // lang-sql registers two sources: schema names, then keywords.
          autocompletion({ override: [semanticSource, fallbackSource(0), fallbackSource(1), templateSource] }),
          diagnosticsField,
          diagnosticHover,
          // In-editor find/replace (Ctrl/Cmd+F). The panel sits at the top and
          // matches are highlighted; searchKeymap adds find-next/prev + replace.
          search({ top: true }),
          highlightSelectionMatches(),
          syntaxHighlighting(sqlHighlight, { fallback: true }),
          sqlConf.of(sqlExt()),
          nav.extension,
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
            // acceptCompletion returns false when no list is open; Tab then
            // expands a template abbreviation, else falls through to
            // indentWithTab. Inside an expanded template, Tab/Shift-Tab move
            // between its placeholders (snippet keymap, highest precedence).
            { key: "Tab", run: acceptCompletion },
            { key: "Tab", run: expandTemplate },
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
            if (u.docChanged) scheduleDiagnostics();
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
    void props.foreignKeys; // join conditions arrive like columns do
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

  // New schema facts, or the setting flipped: diagnose again.
  createEffect(() => {
    schemaNow();
    void props.missingTables;
    void props.diagnostics;
    void props.dialect;
    scheduleDiagnostics();
  });

  onCleanup(() => {
    clearTimeout(diagTimer);
    view?.destroy();
  });

  // Right-click menu: format / run / select-all / copy, all operating on the
  // live editor. Copy uses the current selection, or the whole document when
  // nothing is selected.
  const editorMenu = (e: MouseEvent): MenuItem[] => {
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
      ...navMenu(e),
      ...(props.onLocalHistory
        ? [{ separator: true }, { label: t("lhist.menu"), action: props.onLocalHistory }]
        : []),
    ];
  };

  // Navigation entries act on the identifier under the right-click.
  const navMenu = (e: MouseEvent): MenuItem[] => {
    const v = view;
    if (!v) return [];
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
    const can = nav.available(v, pos);
    return [
      { separator: true },
      { label: t("editor.goToDefinition"), action: () => nav.goToDefinition(v, pos), disabled: !can.definition },
      { label: t("editor.findUsages"), action: () => nav.findUsages(v, pos), disabled: !can.symbol },
      { label: t("editor.renameSymbol"), action: () => nav.rename(v, pos), disabled: !can.symbol },
    ];
  };

  return (
    <div class="editor" ref={host} onContextMenu={(e) => openContextMenu(e, editorMenu(e))} />
  );
}
