import { describe, it, expect, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { SearchQuery, openSearchPanel, setSearchQuery } from "@codemirror/search";
import { completionStatus, currentCompletions, selectedCompletion, startCompletion } from "@codemirror/autocomplete";
import { SqlEditor } from "../../src/components/SqlEditor";
import type { RunInfo, RunScope } from "../../src/utils/runScope";
import type { ErrorMark } from "../../src/components/SqlEditor";
import { BUILTIN_TEMPLATES, type SqlTemplate } from "../../src/utils/sqlTemplates";

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

  // Audit P4: the find panel speaks Spanish and says «1 de 2».
  it("shows the find panel in Spanish with a live match count", () => {
    const view = mount("select 1; select 2", () => {});
    openSearchPanel(view);
    const panel = host!.querySelector(".cm-search")!;
    expect(panel.querySelector<HTMLInputElement>("input[name=search]")!.placeholder).toBe("Buscar");
    expect(panel.querySelector("button[name=replaceAll]")!.textContent).toBe("Reemplazar todas");
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "select" })) });
    view.dispatch({ selection: EditorSelection.single(0, 6) });
    const count = panel.querySelector(".cm-search-count")!;
    expect(count.getAttribute("role")).toBe("status");
    expect(count.textContent).toBe("1 de 2");
  });

  it("runs the selection with scope 'selection'", () => {
    let ran: { sql: string; scope?: RunScope } | null = null;
    const view = mount("SELECT 1; SELECT 2", (sql, scope) => (ran = { sql, scope }));
    view.dispatch({ selection: { anchor: 0, head: 8 } }); // "SELECT 1"
    modEnter(view);
    expect(ran).toEqual({ sql: "SELECT 1", scope: "selection" });
  });

  it("runs the single statement with scope 'statement'", () => {
    let ran: { sql: string; scope?: RunScope } | null = null;
    const view = mount("SELECT * FROM t", (sql, scope) => (ran = { sql, scope }));
    view.dispatch({ selection: { anchor: 5, head: 5 } }); // caret, no selection
    modEnter(view);
    expect(ran).toEqual({ sql: "SELECT * FROM t", scope: "statement" });
  });

  it("runs only the statement under the cursor when there are several (issue #691)", () => {
    let ran: { sql: string; scope?: RunScope } | null = null;
    const doc = "SELECT 1;\nSELECT 2;";
    const view = mount(doc, (sql, scope) => (ran = { sql, scope }));
    view.dispatch({ selection: { anchor: doc.length - 3, head: doc.length - 3 } }); // in "SELECT 2"
    modEnter(view);
    expect(ran).toEqual({ sql: "SELECT 2", scope: "statement" });
  });

  it("runs the whole script on Ctrl/Cmd+Shift+Enter, wherever the cursor is", () => {
    let ran: { sql: string; scope?: RunScope } | null = null;
    const doc = "SELECT 1;\nSELECT 2;";
    const view = mount(doc, (sql, scope) => (ran = { sql, scope }));
    view.dispatch({ selection: { anchor: 2, head: 2 } });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    expect(ran).toEqual({ sql: doc, scope: "document" });
  });

  it("marks the statement that will run, in the text and the gutter", () => {
    const doc = "SELECT 1;\nSELECT a,\n  b FROM t;";
    const view = mount(doc, () => {});
    view.dispatch({ selection: { anchor: doc.indexOf("b FROM") } });
    const marked = [...view.dom.querySelectorAll(".cm-line.cm-runRange")].map((l) => l.textContent);
    expect(marked).toEqual(["SELECT a,", "  b FROM t;"]);
    expect(view.dom.querySelectorAll(".cm-gutter-run").length).toBeGreaterThan(0);
    // A selection is shown as itself: no band on top of it.
    view.dispatch({ selection: { anchor: 0, head: 8 } });
    expect(view.dom.querySelectorAll(".cm-runRange")).toHaveLength(0);
  });

  it("marks nothing when the statement is the whole editor", () => {
    const view = mount("SELECT 1", () => {});
    expect(view.dom.querySelectorAll(".cm-runRange")).toHaveLength(0);
  });
});

describe("SqlEditor toolbar run (runRequest)", () => {
  it("runs the current selection, then the scope asked for, when the tick bumps", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [req, setReq] = createSignal<{ tick: number; scope?: RunScope }>({ tick: 0 });
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
            runRequest={req()}
          />
        ),
        host!,
      );
    });
    const view = EditorView.findFromDOM(host!)!;
    view.dispatch({ selection: { anchor: 0, head: 8 } }); // "SELECT 1"
    setReq({ tick: 1 }); // toolbar Run button
    expect(ran).toEqual({ sql: "SELECT 1", scope: "selection" });
    setReq({ tick: 2, scope: "document" }); // «Script completo» in its menu
    expect(ran).toEqual({ sql: "SELECT 1; SELECT 2", scope: "document" });
    setReq({ tick: 3, scope: "statement" }); // «Sentencia actual», despite the selection
    expect(ran).toEqual({ sql: "SELECT 1", scope: "statement" });
  });

  it("reports what a run would execute via onRunInfo", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const states: RunInfo[] = [];
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => "SELECT 1;\nSELECT 2;\nSELECT 3"}
            onChange={() => {}}
            onRun={() => {}}
            dialect="sqlite"
            onRunInfo={(info) => states.push(info)}
          />
        ),
        host!,
      );
    });
    const view = EditorView.findFromDOM(host!)!;
    // Reported once on mount, before anything moves.
    expect(states[0]).toEqual({ hasSelection: false, statement: { first: 1, last: 1 }, statements: 3, firstWrite: null });
    view.dispatch({ selection: { anchor: 0, head: 6 } }); // select "SELECT"
    expect(states.at(-1)!.hasSelection).toBe(true);
    view.dispatch({ selection: { anchor: 12, head: 12 } }); // into "SELECT 2"
    expect(states.at(-1)).toEqual({ hasSelection: false, statement: { first: 2, last: 2 }, statements: 3, firstWrite: null });
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

describe("SqlEditor save-as-snippet (issue #320)", () => {
  // Saving must capture exactly what running would, so the user never has to
  // learn a second rule for "what does this button act on".
  const mount = (doc: string) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [tick, setTick] = createSignal(0);
    let asked: { sql: string; scope: RunScope } | null = null;
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => doc}
            onChange={() => {}}
            onRun={() => {}}
            dialect="sqlite"
            saveTick={tick()}
            onSaveRequest={(sql, scope) => (asked = { sql, scope })}
          />
        ),
        host!,
      );
    });
    return {
      view: EditorView.findFromDOM(host!)!,
      save: () => setTick((n) => n + 1),
      asked: () => asked,
    };
  };

  it("captures the selection", () => {
    const e = mount("SELECT 1; SELECT 2");
    e.view.dispatch({ selection: { anchor: 0, head: 8 } });
    e.save();
    expect(e.asked()).toEqual({ sql: "SELECT 1", scope: "selection" });
  });

  it("captures the statement under the cursor when nothing is selected, as a run would", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    const e = mount(doc);
    e.view.dispatch({ selection: { anchor: 2, head: 2 } });
    e.save();
    expect(e.asked()).toEqual({ sql: "SELECT 1", scope: "statement" });
  });

  it("captures the whole text when there is one statement", () => {
    const e = mount("SELECT * FROM t");
    e.save();
    expect(e.asked()).toEqual({ sql: "SELECT * FROM t", scope: "statement" });
  });

  it("does not ask again until the tick moves", () => {
    const e = mount("SELECT * FROM t");
    expect(e.asked()).toBeNull();
    e.save();
    expect(e.asked()).not.toBeNull();
  });
});

describe("SqlEditor Tab (issue #432)", () => {
  const mount = (doc: string) => {
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
            onRun={() => {}}
            dialect="sqlite"
            schema={{ clientes: ["nombre"] }}
          />
        ),
        host!,
      );
    });
    const view = EditorView.findFromDOM(host!)!;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return view;
  };

  const tab = (view: EditorView) => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
  };

  // The completion source resolves off the current task; poll rather than guess.
  // Then wait out CodeMirror's interactionDelay (75 ms), which refuses an accept
  // fired the instant the list pops open so a keystroke in flight cannot take it.
  const untilSuggesting = async (view: EditorView) => {
    for (let i = 0; i < 200; i++) {
      if (completionStatus(view.state) === "active") {
        await new Promise((r) => setTimeout(r, 120));
        return true;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    return false;
  };

  it("accepts the open suggestion", async () => {
    const view = mount("select * from clie");
    startCompletion(view);
    expect(await untilSuggesting(view)).toBe(true);
    tab(view);
    expect(view.state.doc.toString()).toBe("select * from clientes");
  });

  it("still indents when no suggestion is open", () => {
    const view = mount("select 1");
    expect(completionStatus(view.state)).toBe(null);
    tab(view);
    expect(view.state.doc.toString()).not.toBe("select 1");
    expect(view.state.doc.toString()).toContain("select 1");
  });
});

describe("SqlEditor semantic completion (issue #661)", () => {
  const mount = (doc: string, props: Record<string, unknown> = {}) => {
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
            onRun={() => {}}
            dialect="sqlite"
            schema={{ clientes: ["id", "nombre"], pedidos: ["id", "cliente_id"] }}
            {...props}
          />
        ),
        host!,
      );
    });
    return EditorView.findFromDOM(host!)!;
  };

  const options = async (view: EditorView) => {
    for (let i = 0; i < 200; i++) {
      if (completionStatus(view.state) === "active") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    return currentCompletions(view.state).map((c) => c.label);
  };

  it("completes an alias's columns", async () => {
    const view = mount("select c. from clientes c");
    view.dispatch({ selection: { anchor: "select c.".length } });
    startCompletion(view);
    expect(await options(view)).toEqual(expect.arrayContaining(["id", "nombre"]));
  });

  it("completes the join condition from the foreign keys", async () => {
    const view = mount("select * from clientes c join pedidos p on ", {
      foreignKeys: [{ fromTable: "pedidos", toTable: "clientes", constraint: "fk", columns: [{ from: "cliente_id", to: "id" }] }],
    });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
    expect(await options(view)).toContain("p.cliente_id = c.id");
  });

  it("names each suggestion's kind in words and lists a table's columns beside it (M14)", async () => {
    const view = mount("select * from clie");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
    expect(await options(view)).toContain("clientes");
    // The list draws a kind column, not a glyph.
    for (let i = 0; i < 100 && !host!.querySelector(".cm-completionKind"); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const row = [...host!.querySelectorAll(".cm-tooltip-autocomplete li")].find((li) =>
      li.querySelector(".cm-completionLabel")?.textContent === "clientes",
    )!;
    expect(row.querySelector(".cm-completionKind")!.textContent).toBe("tabla");
    expect(host!.querySelector(".cm-completionIcon")).toBeNull();
    const pick = currentCompletions(view.state).find((c) => c.label === "clientes")!;
    const info = (pick.info as (c: typeof pick) => Node | null)(pick) as HTMLElement;
    expect(info.textContent).toContain("tabla · 2 columnas");
    expect([...info.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["id", "nombre"]);
    // The key hints the stylesheet draws under the list.
    expect(host!.querySelector<HTMLElement>(".editor")!.style.getPropertyValue("--complete-footer")).toContain("Esc cerrar");
  });

  it("falls back to lang-sql where it has nothing to add", async () => {
    // `clientes.` names no relation of the statement, but lang-sql knows the table.
    const view = mount("select clientes. from x");
    view.dispatch({ selection: { anchor: "select clientes.".length } });
    startCompletion(view);
    expect(await options(view)).toEqual(expect.arrayContaining(["id", "nombre"]));
  });
});

describe("SqlEditor diagnostics (issue #662)", () => {
  const mount = (doc: string, diagnostics?: boolean) => {
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
            onRun={() => {}}
            dialect="sqlite"
            diagnostics={diagnostics}
          />
        ),
        host!,
      );
    });
    return EditorView.findFromDOM(host!)!;
  };
  const settle = () => new Promise((r) => setTimeout(r, 400));

  it("marks a DELETE without WHERE once typing settles", async () => {
    mount("delete from t");
    await settle();
    const mark = host!.querySelector(".cm-diag-warning");
    expect(mark?.textContent).toBe("delete");
  });

  it("marks nothing when turned off", async () => {
    mount("delete from t", false);
    await settle();
    expect(host!.querySelector(".cm-diag")).toBeNull();
  });
});

describe("SqlEditor navigation and rename (issues #663, #664)", () => {
  const mount = (doc: string, onGoToObject?: (target: unknown) => void) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    let text = doc;
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => doc}
            onChange={(_id, sql) => (text = sql)}
            onRun={() => {}}
            dialect="postgres"
            onGoToObject={onGoToObject}
          />
        ),
        host!,
      );
    });
    return { view: EditorView.findFromDOM(host!)!, text: () => text };
  };

  const press = (view: EditorView, key: string, mods: KeyboardEventInit = {}) =>
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));

  const caretAt = (view: EditorView, offset: number) => view.dispatch({ selection: { anchor: offset } });

  it("F12 on an alias qualifier selects its declaration", () => {
    const doc = "SELECT c.id FROM clientes c";
    const { view } = mount(doc);
    caretAt(view, 7);
    press(view, "F12");
    expect(view.state.selection.main.from).toBe(doc.lastIndexOf("c"));
    expect(view.state.selection.main.to).toBe(doc.length);
  });

  it("F12 on a table asks the app to show the object", () => {
    let target: unknown = null;
    const { view } = mount("SELECT * FROM ventas.clientes", (t) => (target = t));
    caretAt(view, 24);
    press(view, "F12");
    expect(target).toEqual({ kind: "table", name: "ventas.clientes" });
  });

  it("F12 on a call asks for the routine", () => {
    let target: unknown = null;
    const { view } = mount("SELECT total_de(1)", (t) => (target = t));
    caretAt(view, 9);
    press(view, "F12");
    expect(target).toEqual({ kind: "routine", name: "total_de", schema: undefined });
  });

  it("Shift+F12 paints every usage, F3 steps through them and Escape clears", () => {
    const doc = "SELECT c.id FROM clientes c WHERE c.id > 0";
    const { view } = mount(doc);
    caretAt(view, 7);
    press(view, "F12", { shiftKey: true });
    expect(view.dom.querySelectorAll(".cm-usage").length).toBe(3);
    expect(view.dom.querySelector(".cm-usages")?.textContent).toContain("3");
    press(view, "F3");
    expect(view.state.selection.main.from).toBe(26);
    press(view, "F3");
    expect(view.state.selection.main.from).toBe(34);
    press(view, "F3", { shiftKey: true });
    expect(view.state.selection.main.from).toBe(26);
    press(view, "Escape");
    expect(view.dom.querySelectorAll(".cm-usage").length).toBe(0);
  });

  it("Alt+F7 finds usages too", () => {
    const { view } = mount("SELECT c.id FROM clientes c");
    caretAt(view, 7);
    press(view, "F7", { altKey: true });
    expect(view.dom.querySelectorAll(".cm-usage").length).toBe(2);
  });

  it("F2 renames in one undoable step through the inline prompt", async () => {
    const doc = "SELECT c.id FROM clientes c WHERE 'c' = c.nombre";
    const { view, text } = mount(doc);
    caretAt(view, 7);
    press(view, "F2");
    const form = view.dom.querySelector(".cm-rename form") as HTMLFormElement;
    const input = form.querySelector("input")!;
    expect(input.value).toBe("c");
    input.value = "cli";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(text()).toBe("SELECT cli.id FROM clientes cli WHERE 'c' = cli.nombre");
    press(view, "z", { ctrlKey: true });
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("Shift+F6 refuses an invalid name and keeps the prompt open", async () => {
    const doc = "SELECT c.id FROM clientes c";
    const { view } = mount(doc);
    caretAt(view, 7);
    press(view, "F6", { shiftKey: true });
    const form = view.dom.querySelector(".cm-rename form") as HTMLFormElement;
    form.querySelector("input")!.value = "   ";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.dom.querySelector(".cm-rename")?.textContent).toMatch(/vac[ií]o|empty/);
  });
});

describe("SqlEditor multicursor and templates (issue #665)", () => {
  const mount = (
    doc: string,
    opts: { templates?: SqlTemplate[]; onRun?: (sql: string, scope?: RunScope) => void } = {},
  ) => {
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
            onRun={opts.onRun ?? (() => {})}
            dialect="sqlite"
            templates={opts.templates}
          />
        ),
        host!,
      );
    });
    const view = EditorView.findFromDOM(host!)!;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return view;
  };

  const key = (view: EditorView, init: KeyboardEventInit) =>
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  const selected = (view: EditorView) =>
    view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to));
  const builtins = [...BUILTIN_TEMPLATES];

  it("Mod-d selects the word, then adds its next occurrence as another selection", () => {
    const view = mount("a = 1 OR a = 2 OR b = a");
    view.dispatch({ selection: { anchor: 0 } });
    key(view, { key: "d", ctrlKey: true });
    expect(selected(view)).toEqual(["a"]);
    key(view, { key: "d", ctrlKey: true });
    expect(view.state.selection.ranges.map((r) => r.from)).toEqual([0, 9]);
    // Typing then edits every occurrence at once.
    view.dispatch(view.state.replaceSelection("x"));
    expect(view.state.doc.toString()).toBe("x = 1 OR x = 2 OR b = a");
  });

  it("runs the main selection when there are several", () => {
    let ran = "";
    const view = mount("SELECT 1; SELECT 2;", { onRun: (sql) => (ran = sql) });
    view.dispatch({
      selection: EditorSelection.create(
        [EditorSelection.range(0, 8), EditorSelection.range(10, 18)],
        1,
      ),
    });
    expect(view.state.selection.ranges).toHaveLength(2);
    key(view, { key: "Enter", ctrlKey: true });
    expect(ran).toBe("SELECT 2");
  });

  it("expands an abbreviation on Tab and moves between its placeholders", () => {
    const view = mount("SEL", { templates: builtins });
    key(view, { key: "Tab" });
    expect(view.state.doc.toString()).toBe("SELECT columns FROM table WHERE condition");
    expect(selected(view)).toEqual(["columns"]);
    key(view, { key: "Tab" });
    expect(selected(view)).toEqual(["table"]);
    key(view, { key: "Tab", shiftKey: true });
    expect(selected(view)).toEqual(["columns"]);
    key(view, { key: "Tab" });
    key(view, { key: "Tab" });
    // The last placeholder ends the template: Tab is plain Tab again.
    expect(selected(view)).toEqual(["condition"]);
  });

  it("edits a repeated placeholder in every place at once", () => {
    const view = mount("cte", { templates: builtins });
    key(view, { key: "Tab" });
    expect(selected(view)).toEqual(["name", "name"]);
    view.dispatch(view.state.replaceSelection("t"));
    expect(view.state.doc.toString()).toBe("WITH t AS (\n  query\n)\nSELECT * FROM t");
  });

  it("does not expand a word that is not an abbreviation; Tab indents instead", () => {
    const view = mount("selx", { templates: builtins });
    key(view, { key: "Tab" });
    expect(view.state.doc.toString()).toContain("selx");
    expect(view.state.doc.toString()).not.toContain("SELECT");
  });

  it("offers a template in the completion list, on top when typed in full", async () => {
    const view = mount("del", { templates: builtins });
    startCompletion(view);
    for (let i = 0; i < 200 && completionStatus(view.state) !== "active"; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(selectedCompletion(view.state)?.label).toBe("del");
    await new Promise((r) => setTimeout(r, 120)); // CodeMirror's interactionDelay
    key(view, { key: "Tab" });
    expect(view.state.doc.toString()).toBe("DELETE FROM table WHERE condition");
    expect(selected(view)).toEqual(["table"]);
  });
});

describe("SqlEditor error line and gutter (issue #691)", () => {
  const mount = (doc: string) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [mark, setMark] = createSignal<ErrorMark | null>(null);
    const [reveal, setReveal] = createSignal(0);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SqlEditor
            activeId={1}
            sqlFor={() => doc}
            onChange={() => {}}
            onRun={() => {}}
            dialect="mysql"
            errorMark={mark()}
            revealErrorTick={reveal()}
          />
        ),
        host!,
      );
    });
    return { view: EditorView.findFromDOM(host!)!, setMark, setReveal };
  };
  const errorLines = (view: EditorView) =>
    [...view.dom.querySelectorAll(".cm-line.cm-errorLine")].map((l) => l.textContent);

  it("marks the line the engine blamed, inside the failed statement", () => {
    const { view, setMark } = mount("SELECT 1;\nSELECT *\nFORM t;");
    setMark({ sql: "SELECT *\nFORM t", line: 2 });
    expect(errorLines(view)).toEqual(["FORM t;"]);
    expect(view.dom.querySelectorAll(".cm-gutter-error").length).toBeGreaterThan(0);
  });

  it("marks the statement's first line when no line was named, and clears on edit", () => {
    const { view, setMark } = mount("SELECT 1;\nSELECT *\nFORM t;");
    setMark({ sql: "SELECT *\nFORM t", line: null });
    expect(errorLines(view)).toEqual(["SELECT *"]);
    view.dispatch({ changes: { from: 0, insert: "-- " } });
    expect(errorLines(view)).toEqual([]);
  });

  it("moves the cursor to the failed line when asked", () => {
    const doc = "SELECT 1;\nSELECT *\nFORM t;";
    const { view, setMark, setReveal } = mount(doc);
    setMark({ sql: "SELECT *\nFORM t", line: 2 });
    setReveal(1);
    expect(view.state.selection.main.head).toBe(doc.indexOf("FORM"));
  });

  it("draws a fold gutter beside the line numbers", () => {
    const { view } = mount("SELECT 1");
    expect(view.dom.querySelector(".cm-foldGutter")).not.toBeNull();
    expect(view.dom.querySelector(".cm-lineNumbers")).not.toBeNull();
  });
});
