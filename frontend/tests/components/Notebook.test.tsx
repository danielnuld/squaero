import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { Notebook } from "../../src/components/Notebook";

// Formatting a SQL cell (same formatter and key as the SQL editor): the cell is
// a plain textarea, so it carries its own Ctrl/Cmd+Shift+F binding and button.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  localStorage.clear();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => <Notebook connId="c1" engine="sqlite" onChart={() => {}} onClose={() => {}} />,
      host!,
    );
  });
}

const sqlCell = () => host!.querySelector("textarea.nb-src-sql") as HTMLTextAreaElement;

function type(ta: HTMLTextAreaElement, text: string) {
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Notebook SQL cell formatting", () => {
  it("keeps the cell's textarea (and the caret) while typing", async () => {
    mount();
    await flush();
    const ta = sqlCell();
    type(ta, "select 1");
    await flush();
    expect(sqlCell()).toBe(ta);
    expect(ta.isConnected).toBe(true);
  });

  it("formats the cell with Ctrl+Shift+F", async () => {
    mount();
    await flush();
    const ta = sqlCell();
    type(ta, "select a, b from t where a = 1");
    await flush();
    ta.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    await flush();
    expect(sqlCell().value).toContain("SELECT");
    expect(sqlCell().value.includes("\n")).toBe(true);
  });

  it("formats the cell from the button", async () => {
    mount();
    await flush();
    type(sqlCell(), "select 1");
    await flush();
    const btn = [...host!.querySelectorAll("button")].find(
      (b) => b.title.startsWith("Formatear SQL"),
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    await flush();
    expect(sqlCell().value).toBe("SELECT\n  1");
  });
});

describe("Notebook deletions ask first (audit P1)", () => {
  const button = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>("button")].filter(
      (b) => b.getAttribute("aria-label") === label || b.textContent === label,
    );
  const dialog = () => document.querySelector('[role="alertdialog"]');

  it("a cell with content is deleted only after confirming, an empty one at once", async () => {
    mount();
    await flush();
    // Add a second cell so one can be deleted; the new one is empty.
    [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "+SQL")!.click();
    await flush();
    expect(host!.querySelectorAll("textarea.nb-src-sql")).toHaveLength(2);
    type(sqlCell(), "DELETE FROM pedidos");
    button("Eliminar celda")[0].click();
    await flush();
    expect(dialog()!.textContent).toContain("¿Eliminar la celda [1]?");
    expect(dialog()!.textContent).toContain("DELETE FROM pedidos");
    dialog()!.querySelector<HTMLButtonElement>(".btn-danger")!.click();
    await flush();
    expect(host!.querySelectorAll("textarea.nb-src-sql")).toHaveLength(1);

    [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "+SQL")!.click();
    await flush();
    button("Eliminar celda")[1].click(); // the empty one
    await flush();
    expect(dialog()).toBeNull();
    expect(host!.querySelectorAll("textarea.nb-src-sql")).toHaveLength(1);
  });

  it("deleting a notebook names it and counts its cells", async () => {
    mount();
    await flush();
    [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "+ Nuevo")!.click();
    await flush();
    const del = button("Eliminar")[0];
    del.click();
    await flush();
    expect(dialog()!.textContent).toMatch(/¿Eliminar el notebook .+\?/);
    expect(dialog()!.textContent).toContain("su única celda");
    [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Cancelar")!.click();
    await flush();
    expect(dialog()).toBeNull();
  });
});
