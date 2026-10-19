// Integration (audit A-06): the editor completes table names from the working
// database's catalog, read on connect — not from what the tree has expanded.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { EditorView } from "@codemirror/view";
import { completionStatus, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { App } from "../../src/App";
import { openQueryTab } from "./appHelpers";
import { contextMenu, closeContextMenu } from "../../src/utils/contextMenu";

let treeCalls: string[] = [];
let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  treeCalls = [];
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "sqlite", params: { path: ":memory:" } }]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    const p = req.params ?? {};
    let result: unknown = {};
    if (req.method === "conn.open") {
      result = { connId: "c1", features: { cancel: true, transactions: true, introspection: true } };
    } else if (req.method === "schema.tree") {
      treeCalls.push(String(p.db ?? ""));
      result = p.db
        ? {
            columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
            rows: [["clientes", "table"], ["pedidos", "table"]],
            rowsAffected: 0,
            truncated: false,
          }
        : { columns: [{ name: "name", type: "text" }], rows: [["main"]], rowsAffected: 0, truncated: false };
    } else if (req.method === "query.run") {
      result = { columns: [], rows: [], rowsAffected: 0, truncated: false };
    }
    return { jsonrpc: "2.0", id: req.id, result };
  };
});

afterEach(() => {
  closeContextMenu();
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

describe("App — catalog for completion (A-06)", () => {
  it("offers the database's tables after FROM without expanding the tree", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <App />, host!);
    });
    (host.querySelector(".connbar-add") as HTMLElement).click();
    (host.querySelector(".connsearch-hit") as HTMLElement).click();
    await settle();
    openQueryTab(host);
    await settle();
    expect(treeCalls).toContain("main");
    const view = EditorView.findFromDOM(host)!;
    view.dispatch({ changes: { from: 0, insert: "SELECT * FROM cli" }, selection: { anchor: 17 } });
    startCompletion(view);
    for (let i = 0; i < 200 && completionStatus(view.state) !== "active"; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(currentCompletions(view.state).map((c) => c.label)).toContain("clientes");
  });

  it("lists the open connections with the databases, the saved ones, and «Conectar a otra…» (R-02)", async () => {
    localStorage.setItem(
      "quaero.connections",
      JSON.stringify([
        { id: "k1", name: "local", driver: "sqlite", params: { path: ":memory:" } },
        { id: "k2", name: "otra", driver: "sqlite", params: { path: ":memory:" } },
      ]),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <App />, host!);
    });
    (host.querySelector(".connbar-add") as HTMLElement).click();
    (host.querySelector(".connsearch-hit") as HTMLElement).click();
    await settle();
    openQueryTab(host);
    await settle();
    (host.querySelector(".editor-conn") as HTMLElement).click();
    const items = contextMenu()!.items;
    expect(items[0]).toMatchObject({ heading: true, label: "Conexiones abiertas" });
    expect(items.find((i) => i.label === "main")).toMatchObject({ checked: true });
    expect(items.some((i) => i.heading && i.label === "Guardadas · sin conectar")).toBe(true);
    expect(items.find((i) => i.label === "otra")!.hint).toBe("conectar");
    closeContextMenu();
    expect(host.querySelector(".connsearch-hit")).toBeNull();
    (host.querySelector(".editor-conn") as HTMLElement).click();
    contextMenu()!.items.find((i) => i.label === "Conectar a otra…")!.action!();
    await settle();
    expect(host.querySelector(".connsearch-hit")).not.toBeNull();
  });

  it("says what each object is and where in the object palette (M14 ObjectPalette)", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <App />, host!);
    });
    (host.querySelector(".connbar-add") as HTMLElement).click();
    (host.querySelector(".connsearch-hit") as HTMLElement).click();
    await settle();
    const main = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (r) => r.getAttribute("aria-label") === "main",
    )!;
    main.click();
    await settle();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }));
    await settle();
    const item = [...host.querySelectorAll(".cmdk-item")].find((i) => i.textContent?.includes("clientes"))!;
    expect(item.querySelector(".cmdk-item-hint")!.textContent).toBe("tabla · main");
  });
});
