import { describe, it, expect, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { EditorView } from "@codemirror/view";
import { SqlEditor } from "../../src/components/SqlEditor";
import type { RunScope } from "../../src/utils/runScope";

// Drives the real CodeMirror-backed editor in jsdom to check the format wiring
// (issue #106): bumping formatTick reformats the current document and persists
// it via onChange.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

describe("SqlEditor formatting", () => {
  it("reformats the document when formatTick is bumped", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [tick, setTick] = createSignal(0);
    let lastSql = "select a,b from t where x=1";

    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => "select a,b from t where x=1"}
            onChange={(_id, sql) => (lastSql = sql)}
            onRun={() => {}}
            dialect="sqlite"
            formatTick={tick()}
          />
        ),
        host!,
      );
    });

    setTick(1); // request a format
    expect(lastSql).toContain("SELECT");
    expect(lastSql.split("\n").length).toBeGreaterThan(1);
  });
});

describe("SqlEditor run scope (issue #130)", () => {
  const mount = (doc: string, onRun: (sql: string, scope?: RunScope) => void) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => doc}
            onChange={() => {}}
            onRun={onRun}
            dialect="sqlite"
          />
        ),
        host!,
      );
    });
    return EditorView.findFromDOM(host!)!;
  };

  const modEnter = (view: EditorView) => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
  };

  it("runs the selection with scope 'selection'", () => {
    let ran: { sql: string; scope?: RunScope } | null = null;
    const view = mount("SELECT 1; SELECT 2", (sql, scope) => (ran = { sql, scope }));
    view.dispatch({ selection: { anchor: 0, head: 8 } }); // "SELECT 1"
    modEnter(view);
    expect(ran).toEqual({ sql: "SELECT 1", scope: "selection" });
  });

  it("runs the whole single-statement document with scope 'document'", () => {
    let ran: { sql: string; scope?: RunScope } | null = null;
    const view = mount("SELECT * FROM t", (sql, scope) => (ran = { sql, scope }));
    view.dispatch({ selection: { anchor: 5, head: 5 } }); // caret, no selection
    modEnter(view);
    expect(ran).toEqual({ sql: "SELECT * FROM t", scope: "document" });
  });

  it("runs the statement under the cursor with scope 'statement'", () => {
    let ran: { sql: string; scope?: RunScope } | null = null;
    const view = mount("SELECT 1;\nSELECT 2;", (sql, scope) => (ran = { sql, scope }));
    view.dispatch({ selection: { anchor: 2, head: 2 } }); // inside "SELECT 1"
    modEnter(view);
    expect(ran).toEqual({ sql: "SELECT 1", scope: "statement" });
  });
});

describe("SqlEditor toolbar run (runTick)", () => {
  it("runs the current selection when runTick bumps", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [tick, setTick] = createSignal(0);
    let ran: { sql: string; scope?: RunScope } | null = null;
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => "SELECT 1; SELECT 2"}
            onChange={() => {}}
            onRun={(sql, scope) => (ran = { sql, scope })}
            dialect="sqlite"
            runTick={tick()}
          />
        ),
        host!,
      );
    });
    const view = EditorView.findFromDOM(host!)!;
    view.dispatch({ selection: { anchor: 0, head: 8 } }); // "SELECT 1"
    setTick(1); // toolbar Run button
    expect(ran).toEqual({ sql: "SELECT 1", scope: "selection" });
  });

  it("reports whether a selection exists via onSelectionChange", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const states: boolean[] = [];
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => "SELECT 1"}
            onChange={() => {}}
            onRun={() => {}}
            dialect="sqlite"
            onSelectionChange={(has) => states.push(has)}
          />
        ),
        host!,
      );
    });
    const view = EditorView.findFromDOM(host!)!;
    view.dispatch({ selection: { anchor: 0, head: 6 } }); // select "SELECT"
    expect(states.at(-1)).toBe(true);
    view.dispatch({ selection: { anchor: 3, head: 3 } }); // collapse the selection
    expect(states.at(-1)).toBe(false);
  });
});

describe("SqlEditor snippet insertion (issue #129)", () => {
  it("inserts the requested text at the cursor when the tick bumps", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [req, setReq] = createSignal({ text: "", tick: 0 });
    let lastSql = "SELECT  FROM t";

    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => "SELECT  FROM t"}
            onChange={(_id, sql) => (lastSql = sql)}
            onRun={() => {}}
            dialect="sqlite"
            insertRequest={req()}
          />
        ),
        host!,
      );
    });

    const view = EditorView.findFromDOM(host!)!;
    view.dispatch({ selection: { anchor: 7, head: 7 } }); // between the two spaces
    setReq({ text: "*", tick: 1 });
    expect(view.state.doc.toString()).toBe("SELECT * FROM t");
    expect(lastSql).toBe("SELECT * FROM t");
    expect(view.state.selection.main.head).toBe(8); // cursor after the inserted text
  });
});
