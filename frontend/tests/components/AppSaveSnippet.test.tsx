import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { EditorView } from "@codemirror/view";
import { App } from "../../src/App";
import { parseSnippets } from "../../src/utils/snippets";

// Saving the query you are writing (issue #320), driven through the real
// workspace: the editor's own toolbar names it and the set lands in storage —
// no tab opens over the query at any point.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => localStorage.removeItem("quaero.snippets"));

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  localStorage.removeItem("quaero.snippets");
});

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  return EditorView.findFromDOM(host!)!;
};

const byText = (sel: string, text: string) =>
  [...host!.querySelectorAll(sel)].find((b) => b.textContent?.trim() === text) as HTMLElement;

const saveButton = () => byText(".editor-hint .status-btn", "Guardar");
const nameField = () => host!.querySelector(".snip-save-input") as HTMLInputElement | null;
const toast = () => host!.querySelector(".app-toast");
const stored = () => parseSnippets(localStorage.getItem("quaero.snippets"));

const tabs = () => [...host!.querySelectorAll('[role="tab"]')] as HTMLElement[];
const tabNames = () => tabs().map((t) => t.getAttribute("aria-label"));
const tabByName = (name: string) => tabs().find((t) => t.getAttribute("aria-label") === name)!;
const selectedTabName = () =>
  tabs().find((t) => t.getAttribute("aria-selected") === "true")?.getAttribute("aria-label");

/** The live editor: it is torn down and rebuilt whenever a tool tab takes over. */
const editor = () => EditorView.findFromDOM(host!)!;

const seed = () =>
  localStorage.setItem(
    "quaero.snippets",
    JSON.stringify([{ id: "snip-1", name: "cuadernos", body: "SELECT * FROM cuadernos" }]),
  );

const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const press = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

describe("Saving a query as a snippet from the editor", () => {
  it("proposes the table's name and saves it without leaving the editor", () => {
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "SELECT * FROM cuadernos WHERE anio = 2026" } });

    saveButton().click();
    const field = nameField()!;
    // The proposed name is the table the query reads, so accepting is one key.
    expect(field.value).toBe("cuadernos");
    // The editor is still there: naming happens in its toolbar, not over it.
    expect(host!.querySelector(".editor-pane")).not.toBeNull();

    press(field, "Enter");
    expect(stored().map((s) => s.name)).toEqual(["cuadernos"]);
    expect(stored()[0].body).toContain("FROM cuadernos");
    expect(nameField()).toBeNull();
    expect(toast()?.textContent).toContain("cuadernos");
    expect(toast()?.textContent).toContain("documento");
  });

  it("saves the typed name when the user replaces the proposal", () => {
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "SELECT * FROM cuadernos" } });
    saveButton().click();
    type(nameField()!, "cuadernos del año");
    press(nameField()!, "Enter");
    expect(stored().map((s) => s.name)).toEqual(["cuadernos del año"]);
  });

  it("saves only the selection when there is one", () => {
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "SELECT 1; SELECT 2" } });
    view.dispatch({ selection: { anchor: 0, head: 8 } });
    saveButton().click();
    press(nameField()!, "Enter");
    expect(stored()[0].body).toBe("SELECT 1");
    expect(toast()?.textContent).toContain("selección");
  });

  it("cancels on Escape without saving", () => {
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "SELECT * FROM cuadernos" } });
    saveButton().click();
    press(nameField()!, "Escape");
    expect(nameField()).toBeNull();
    expect(stored()).toEqual([]);
  });

  it("never overwrites a snippet that already has the name", () => {
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "SELECT * FROM cuadernos" } });
    saveButton().click();
    press(nameField()!, "Enter");

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "SELECT consec FROM cuadernos" } });
    saveButton().click();
    press(nameField()!, "Enter");

    expect(stored().map((s) => s.name)).toEqual(["cuadernos", "cuadernos (2)"]);
    expect(stored()[0].body).toBe("SELECT * FROM cuadernos");
    expect(toast()?.textContent).toContain("cuadernos (2)");
  });

  it("undoes the save from the confirmation", () => {
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "SELECT * FROM cuadernos" } });
    saveButton().click();
    press(nameField()!, "Enter");
    expect(stored()).toHaveLength(1);

    byText(".app-toast-action", "Deshacer").click();
    expect(stored()).toEqual([]);
    expect(toast()).toBeNull();
  });

  it("says there is nothing to save for an empty editor", () => {
    mount();
    saveButton().click();
    expect(nameField()).toBeNull();
    expect(host!.querySelector(".app-toast")?.textContent).toContain("vacía");
    expect(stored()).toEqual([]);
  });
});

describe("The snippet palette (Ctrl+J)", () => {
  const ctrlJ = () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true }));

  it("opens scoped to snippets, with the body and the key hints", () => {
    seed();
    mount();
    ctrlJ();
    expect(host!.querySelector(".cmdk")).not.toBeNull();
    // Only snippets: the tools and actions of the full palette stay out.
    const groups = [...host!.querySelectorAll(".cmdk-group-label")].map((g) => g.textContent);
    expect(groups).toEqual(["Snippets"]);
    expect(host!.querySelector(".cmdk-preview")?.textContent).toBe("SELECT * FROM cuadernos");
    expect(host!.querySelector(".cmdk-footer")?.textContent).toContain("Shift+Enter");
  });

  it("says the set is empty instead of showing an empty list", () => {
    mount();
    ctrlJ();
    expect(host!.querySelector(".cmdk-empty")?.textContent).toContain("no has guardado");
  });

  it("opens the snippet in its own tab on Enter, leaving the query alone", () => {
    seed();
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "SELECT lo_que_estaba_escribiendo" } });

    ctrlJ();
    press(host!.querySelector(".cmdk-input")!, "Enter");

    // A second tab, named after the snippet and holding its body.
    expect(tabNames()).toEqual(["Consulta 1", "cuadernos"]);
    expect(selectedTabName()).toBe("cuadernos");
    expect(view.state.doc.toString()).toBe("SELECT * FROM cuadernos");
    // And the query it was written over is untouched, which is the whole point.
    tabByName("Consulta 1").click();
    expect(view.state.doc.toString()).toBe("SELECT lo_que_estaba_escribiendo");
  });

  it("reopens the tab a snippet already has instead of a second one", () => {
    seed();
    mount();
    ctrlJ();
    press(host!.querySelector(".cmdk-input")!, "Enter");
    ctrlJ();
    press(host!.querySelector(".cmdk-input")!, "Enter");
    expect(tabNames()).toEqual(["Consulta 1", "cuadernos"]);
    expect(selectedTabName()).toBe("cuadernos");
  });

  it("inserts at the cursor with Ctrl+Enter, the explicit ask", () => {
    seed();
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "SELECT 1; " } });
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    ctrlJ();
    host!
      .querySelector(".cmdk-input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));

    expect(view.state.doc.toString()).toBe("SELECT 1; SELECT * FROM cuadernos");
    expect(tabNames()).toEqual(["Consulta 1"]); // no new tab for an insertion
  });
});

// Issue #338: the reported failure was "I open one and nothing happens". Its
// cause was the remembered query tab being gone; these drive the two paths that
// used to hit it — from the panel (which is itself a tab, so the editor is not
// even mounted) and after closing the only query tab.
describe("Reaching the editor from the snippets panel", () => {
  const openPanel = () => byText(".editor-hint .status-btn", "Snippets").click();
  const panelAction = (label: string) =>
    ([...host!.querySelectorAll(".snippet-actions .link")].find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement);

  it("inserts into the query editor from the panel's own tab", () => {
    seed();
    mount();
    openPanel();
    expect(host!.querySelector(".editor-pane")).toBeNull(); // the panel took over

    panelAction("Insertar").click();
    // The editor is remounted by the switch back, so re-read it from the DOM.
    expect(editor().state.doc.toString()).toBe("SELECT * FROM cuadernos");
    expect(selectedTabName()).toBe("Consulta 1");
  });

  it("opens the snippet even when its remembered query tab was closed", () => {
    seed();
    mount();
    openPanel();
    // Close the only query tab: the remembered id now points at nothing.
    (tabByName("Consulta 1").querySelector(".tab-close") as HTMLElement).click();
    expect(tabNames()).toEqual(["Snippets"]);

    panelAction("Abrir").click();
    expect(tabNames()).toEqual(["Snippets", "cuadernos"]);
    expect(editor().state.doc.toString()).toBe("SELECT * FROM cuadernos");
  });

  it("falls back to opening when there is no editor left to insert into", () => {
    seed();
    mount();
    openPanel();
    (tabByName("Consulta 1").querySelector(".tab-close") as HTMLElement).click();

    panelAction("Insertar").click();
    expect(tabNames()).toEqual(["Snippets", "cuadernos"]);
    expect(editor().state.doc.toString()).toBe("SELECT * FROM cuadernos");
  });
});

// Issue #338: a snippet's tab behaves like the document it is — Ctrl+Shift+S
// offers that snippet's own name, and accepting it saves back rather than
// leaving a second copy behind.
describe("Editing a snippet in its own tab", () => {
  const openSnippet = () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true }));
    press(host!.querySelector(".cmdk-input")!, "Enter");
    return editor();
  };

  it("offers the snippet's own name and replaces its body", () => {
    seed();
    mount();
    const view = openSnippet();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "SELECT 1 FROM cuadernos" } });

    saveButton().click();
    expect(nameField()!.value).toBe("cuadernos"); // its own name, not a proposal
    press(nameField()!, "Enter");

    expect(stored()).toEqual([
      { id: "snip-1", name: "cuadernos", body: "SELECT 1 FROM cuadernos" },
    ]);
    expect(toast()?.textContent).toContain("Actualizado");
  });

  it("forks a new snippet when the name is changed, leaving the original", () => {
    seed();
    mount();
    const view = openSnippet();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "SELECT 1" } });

    saveButton().click();
    type(nameField()!, "cuadernos de este año");
    press(nameField()!, "Enter");

    expect(stored()).toEqual([
      { id: "snip-1", name: "cuadernos", body: "SELECT * FROM cuadernos" }, // untouched
      { id: "snip-2", name: "cuadernos de este año", body: "SELECT 1" },
    ]);
  });

  it("undoing an update restores the previous body, it does not delete", () => {
    seed();
    mount();
    const view = openSnippet();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "SELECT 1" } });
    saveButton().click();
    press(nameField()!, "Enter");

    byText(".app-toast-action", "Deshacer").click();
    expect(stored()).toEqual([
      { id: "snip-1", name: "cuadernos", body: "SELECT * FROM cuadernos" },
    ]);
  });

  it("marks the tab while the body differs from the saved one", () => {
    seed();
    mount();
    const view = openSnippet();
    expect(tabNames()).toContain("cuadernos"); // in step with what is stored

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "SELECT 1" } });
    expect(tabNames()).toContain("cuadernos · con cambios sin guardar");

    saveButton().click();
    press(nameField()!, "Enter");
    expect(tabNames()).toContain("cuadernos");
  });

  it("leaves a plain query tab on the proposed name", () => {
    seed();
    const view = mount();
    view.dispatch({ changes: { from: 0, insert: "SELECT * FROM pedidos" } });
    saveButton().click();
    expect(nameField()!.value).toBe("pedidos"); // the table, not any open snippet
  });
});
