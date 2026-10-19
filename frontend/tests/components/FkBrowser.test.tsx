import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { FkBrowser } from "../../src/components/FkBrowser";
import type { FkLookup } from "../../src/utils/fkLookup";

// The foreign-key browser as the shared grid (A-40): select a row, then
// Seleccionar, Enter or a double click; no «Elegir» button per row.

const lookup: FkLookup = {
  toTable: "clientes",
  toColumn: "id",
  columns: [
    { name: "nombre", type: "text" },
    { name: "id", type: "int" },
  ],
  rows: [
    ["Ferretería López", "1"],
    ["Aceros SA", "7"],
    ["Papelería Sol", "9"],
  ],
};

let dispose: (() => void) | null = null;
let picked: string[] = [];
let closed = 0;

afterEach(() => {
  dispose?.();
  dispose = null;
  picked = [];
  closed = 0;
});

function mount(current = "") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  // render's own disposer: it is what takes the portalled dialog away.
  const stop = render(
    () => <FkBrowser lookup={lookup} current={current} onPick={(v) => picked.push(v)} onClose={() => closed++} />,
    host,
  );
  dispose = () => {
    stop();
    host.remove();
  };
}

const dialog = () => document.querySelector(".fk-browser")!;
const cell = (r: number, c: number) =>
  dialog().querySelector<HTMLElement>(`.grid-rows [data-cell="${r}-${c}"]`)!;
const selectButton = () =>
  [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Seleccionar")!;

describe("FkBrowser", () => {
  it("shows the referenced rows in the grid, with no button per row", () => {
    mount("7");
    expect(dialog().querySelectorAll(".grid-rows .grid-row").length).toBe(3);
    expect([...dialog().querySelectorAll("button")].some((b) => b.textContent === "Elegir")).toBe(false);
    expect(dialog().textContent).toContain("Valor actual: 7.");
  });

  it("picks the selected row's key with Seleccionar, which waits for a selection", () => {
    mount();
    expect(selectButton().disabled).toBe(true);
    cell(1, 0).click();
    expect(selectButton().disabled).toBe(false);
    selectButton().click();
    expect(picked).toEqual(["7"]);
  });

  it("picks with Enter on the grid and with a double click", () => {
    mount();
    cell(2, 0).click();
    dialog()
      .querySelector(".grid-scroll")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    cell(0, 1).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(picked).toEqual(["9", "1"]);
  });

  it("narrows the rows with the search box and clears the selection", () => {
    mount();
    cell(0, 0).click();
    const box = dialog().querySelector<HTMLInputElement>(".fk-browser-filter")!;
    box.value = "aceros";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dialog().querySelectorAll(".grid-rows .grid-row").length).toBe(1);
    expect(selectButton().disabled).toBe(true);
  });

  it("closes with Escape without picking", () => {
    mount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(closed).toBe(1);
    expect(picked).toEqual([]);
  });
});
