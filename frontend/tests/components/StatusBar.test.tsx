import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { StatusBar } from "../../src/components/StatusBar";

// Issues #386, #693: context on the left (connection, protection, transaction),
// the facts of the document on screen on the right, chosen by the tab's kind.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

type Props = Parameters<typeof StatusBar>[0];

const base: Props = {
  connection: { name: "Ventas (demo)", engine: "SQLite", color: "#2f7dd6", db: "main" },
  kind: "query",
  rowCount: 26,
  truncated: false,
  elapsedMs: 11,
};

function mount(over: Partial<Props> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <StatusBar {...base} {...over} />, host!);
  });
  return host;
}

describe("StatusBar", () => {
  it("names the connection with its engine, database and colour", () => {
    mount();
    const text = host!.textContent ?? "";
    expect(text).toContain("Ventas (demo)");
    expect(text).toContain("SQLite · main");
    const dot = host!.querySelector(".conn-dot") as HTMLElement;
    expect(dot.classList.contains("on")).toBe(true);
    expect(dot.style.getPropertyValue("--conn-accent")).toBe("#2f7dd6");
  });

  it("says when there is no connection, and when it was lost", () => {
    mount({ connection: null });
    expect(host!.textContent).toContain("Sin conexión");
    dispose?.();
    host?.remove();
    mount({ connection: { name: "Ventas", engine: "SQLite", lost: true } });
    expect(host!.textContent).toContain("Ventas (desconectada)");
    expect(host!.querySelector(".conn-dot.lost")).not.toBeNull();
  });

  it("shows a neutral chip for a protected connection", () => {
    mount({ safeMode: "readOnly" });
    const chip = host!.querySelector(".status-chip") as HTMLElement;
    expect(chip.textContent).toContain("Solo lectura");
    expect(chip.classList.contains("status-tx")).toBe(false);
  });

  it("offers the open transaction's actions from its chip", () => {
    let clicked = 0;
    mount({ txStatements: 2, onTxAction: () => clicked++ });
    const chip = host!.querySelector(".status-tx") as HTMLButtonElement;
    expect(chip.textContent).toContain("En transacción · 2");
    chip.click();
    expect(clicked).toBe(1);
  });

  it("gives a query tab rows, columns, time and the cursor", () => {
    mount({ columnCount: 7, cursor: { line: 3, col: 14 }, object: "ventas.clientes" });
    const text = host!.textContent ?? "";
    expect(text).toContain("26 filas");
    expect(text).toContain("7 columnas");
    expect(text).toContain("Lín 3, col 14");
    // A free query does not name an object even if one was passed.
    expect(text).not.toContain("ventas.clientes");
  });

  it("gives a table tab its object and no cursor", () => {
    mount({ kind: "data", object: "ventas.clientes", cursor: { line: 1, col: 1 } });
    const text = host!.textContent ?? "";
    expect(text).toContain("ventas.clientes");
    expect(text).not.toContain("Lín");
  });

  it("shows no facts for a tool tab", () => {
    mount({ kind: "tool" });
    expect(host!.textContent).not.toContain("26 filas");
  });

  it("has no pager, theme or help buttons any more", () => {
    mount({ zoom: 100 });
    expect(host!.querySelector("button")).toBeNull();
  });

  // Issue #670: the selected cells, summed up.
  it("summarizes the selected cells", () => {
    mount({ summary: { count: 3, nulls: 1, sum: "0.3", avg: "0.15", min: "0.1", max: "0.2" } });
    const text = host!.textContent ?? "";
    expect(text).toContain("3 celdas · 1 NULL · Suma 0.3 · Media 0.15 · Mín 0.1 · Máx 0.2");
  });

  it("shows only the count when there is nothing to add up", () => {
    mount({ summary: { count: 2, nulls: 0 } });
    const text = host!.textContent ?? "";
    expect(text).toContain("2 celdas");
    expect(text).not.toContain("Suma");
  });
});

describe("StatusBar with the page search on (A-05)", () => {
  it("says how many of the loaded rows the search leaves", () => {
    mount({ matchCount: 3, rowCount: 12 });
    expect(host!.textContent).toContain("3 de 12 filas");
  });
  it("says the plain count when the search hides nothing", () => {
    mount({ matchCount: null, rowCount: 12 });
    expect(host!.textContent).toContain("12 filas");
    expect(host!.textContent).not.toContain("de 12");
  });
});

describe("StatusBar unsaved changes chip (R-26)", () => {
  it("says how many changes are not saved, and nothing when there are none", () => {
    mount({ pendingChanges: 3 });
    expect(host!.querySelector(".status-pending")!.textContent).toBe("3 cambios sin guardar");
    dispose?.();
    host?.remove();
    mount({ pendingChanges: 0 });
    expect(host!.querySelector(".status-pending")).toBeNull();
  });
});
