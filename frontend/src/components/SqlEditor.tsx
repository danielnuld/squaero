import { onCleanup, onMount, createEffect } from "solid-js";
import { EditorState } from "@codemirror/state";
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
import { closeBrackets } from "@codemirror/autocomplete";

// CodeMirror 6 SQL editor. A single EditorView is reused across query tabs; the
// active tab's text is swapped in on tab change. Ctrl/Cmd+Enter runs the query
// (Mod = Cmd on macOS, Ctrl elsewhere). Pure tab/state logic lives in
// src/utils/tabs.ts — this component is the thin CodeMirror binding.
export function SqlEditor(props: {
  /** Id of the tab currently shown. */
  activeId: number;
  /** Stored SQL for a given tab, used when its text is first loaded. */
  sqlFor: (id: number) => string;
  /** Fired on every edit so the workspace can persist the tab's text. */
  onChange: (id: number, sql: string) => void;
  /** Fired on Ctrl/Cmd+Enter with the live editor contents. */
  onRun: (sql: string) => void;
}) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  // Which tab's text is loaded in the view; guards the change listener while we
  // programmatically swap documents on tab switch. Set on mount to match the
  // doc actually loaded into the view.
  let loaded = props.activeId;
  let swapping = false;

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
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          sql(),
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: () => {
                props.onRun(view!.state.doc.toString());
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !swapping) {
              props.onChange(loaded, view!.state.doc.toString());
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

  onCleanup(() => view?.destroy());

  return <div class="editor" ref={host} />;
}
