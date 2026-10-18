import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Integration (issue #669): pin a result, run again, compare the two. The pure
// comparison is covered by utils/resultCompare; this covers the WIRING — the
// pin survives the next run, and the comparison is drawn in the grid.
//
// The core is faked at the bridge (globalThis.quaeroRpc), the same seam the
// webview binds, so App runs unmodified.

const rs = (columns: [string, string][], rows: (string | null)[][]) => ({
  columns: columns.map(([name, type]) => ({ name, type })),
  rows,
  rowsAffected: rows.length,
  truncated: false,
});

const answer = (method: string, params: Record<string, unknown>): unknown => {
  const sql = String(params.sql ?? "");
  switch (method) {
    case "conn.open":
      return { connId: "c1" };
    case "schema.tree":
      return params.db
        ? rs([["name", "text"], ["type", "text"]], [["pedidos", "table"]])
        : rs([["name", "text"]], [["testdb"]]);
    case "schema.describe":
      return rs(
        [["name", "text"], ["type", "text"], ["pk", "int"]],
        [["id", "int", "1"], ["cliente", "text", "0"]],
      );
    case "query.run":
      if (sql.includes("pedidos")) {
        runs++;
        return rs(
          [["id", "int"], ["cliente", "text"]],
          runs === 1
            ? [["1", "ana"], ["2", "beto"], ["3", null]]
            : [["1", "ana"], ["2", "BETO"], ["4", "dora"]],
        );
      }
      return rs([], []);
    default:
      return {};
  }
};

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
let copied: string[] = [];
let runs = 0;

beforeEach(() => {
  copied = [];
  runs = 0;
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "mysql", params: { host: "127.0.0.1" } }]),
  );
  localStorage.setItem(
    "quaero.history",
    JSON.stringify([
      { sql: "SELECT * FROM pedidos", ts: Date.now(), connId: "k1", connName: "local" },
    ]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    return { jsonrpc: "2.0", id: req.id, result: answer(req.method, req.params ?? {}) };
  };
  // jsdom has no clipboard; the copy helper is best-effort and silently skips
  // without one, which would make this test pass while copying nothing.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t: string) => void copied.push(t) },
  });
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as Record<string, unknown>).quaeroRpc;
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const click = (el: Element | null | undefined) => (el as HTMLElement).click();
const menuItem = (text: string) =>
  [...document.querySelectorAll(".context-menu-item")].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLElement | undefined;

/** Connect and run the history query, leaving three rows in the grid. */
const openWithRows = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  click(host.querySelector(".connbar-add"));
  click(host.querySelector(".connsearch-hit"));
  await settle();
  click(host.querySelector(".empty-history button, .empty-state button"));
  await settle();
  expect(host.querySelectorAll(".grid-rows .grid-row").length).toBe(3);
};

const button = (text: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text));

describe("App — pinning and comparing results (issue #669)", () => {
  it("keeps a pinned result across the next run and compares it by key", async () => {
    await openWithRows();
    click(button("Fijar resultado"));
    await settle();
    expect(host!.querySelectorAll(".pin-tab").length).toBe(1);

    click(button("Refrescar"));
    await settle();
    // The live grid shows the new run; the pin is still there.
    expect(host!.querySelector('[data-cell="1-1"]')!.textContent).toBe("BETO");
    expect(host!.querySelectorAll(".pin-tab").length).toBe(1);

    click(button("Comparar con…"));
    click(menuItem("Fijado"));
    await settle();
    const rows = [...host!.querySelectorAll(".grid-rows .grid-row")].map((r) =>
      [...r.querySelectorAll("[data-cell]")].map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ["~", "2", "beto → BETO"],
      ["−", "3", "NULL"],
      ["+", "4", "dora"],
    ]);
    expect(host!.querySelector('[data-cell="0-2"]')!.classList.contains("diff-changed")).toBe(true);
    expect(host!.querySelector(".compare-bar")!.textContent).toContain("Clave: id");

    // Showing the pin itself: its own rows, read-only, said to be not re-run.
    click(button("Cerrar comparación"));
    click(host!.querySelector(".pin-tab-open"));
    await settle();
    expect(host!.querySelector('[data-cell="1-1"]')!.textContent).toBe("beto");
    expect(host!.querySelector(".pin-note")!.textContent).toContain("no se vuelve a ejecutar");

    // Unpinning returns to the live result.
    click(host!.querySelector(".pin-tab-close"));
    await settle();
    expect(host!.querySelector(".pin-tab")).toBeNull();
    expect(host!.querySelector('[data-cell="1-1"]')!.textContent).toBe("BETO");
  });
});
