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
    localStorage.setItem(
      "quaero.snippets",
      JSON.stringify([{ id: "snip-1", name: "cuadernos", body: "SELECT * FROM cuadernos" }]),
    );
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

  it("inserts the snippet into the editor on Enter", () => {
    localStorage.setItem(
      "quaero.snippets",
      JSON.stringify([{ id: "snip-1", name: "cuadernos", body: "SELECT * FROM cuadernos" }]),
    );
    const view = mount();
    ctrlJ();
    const input = host!.querySelector(".cmdk-input") as HTMLInputElement;
    press(input, "Enter");
    return new Promise((r) => setTimeout(r, 10)).then(() => {
      expect(view.state.doc.toString()).toContain("SELECT * FROM cuadernos");
      expect(host!.querySelector(".cmdk")).toBeNull();
    });
  });
});
