// Integration (#691): the result pane's «Mensajes» and «Plan» views. The core
// is faked at the bridge, as in AppManualTx.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { EditorView } from "@codemirror/view";
import { App } from "../../src/App";
import { openQueryTab } from "./appHelpers";

// Integration (issue #667): manual transactions from the editor. utils/txMode
// covers the policy; this covers the WIRING — the switch, the tx.begin before
// the first change, the indicator, Commit, the typed COMMIT, the guard on grid
// editing and the prompt on disconnect.
//
// The core is faked at the bridge (globalThis.quaeroRpc), as in AppCellFilter.

let calls: string[] = [];
let release: (() => void) | undefined;
let transactions = true;

const answer = (method: string, params: Record<string, unknown>): unknown => {
  switch (method) {
    case "conn.open":
      return {
        connId: "c1",
        features: { cancel: true, transactions, ddl: true, dml: true, schemas: false, introspection: true },
      };
    case "schema.tree":
      return { columns: [{ name: "name", type: "text" }], rows: [], rowsAffected: 0, truncated: false };
    case "query.run":
      calls.push(`query:${String(params.sql)}`);
      return { columns: [], rows: [], rowsAffected: 1, truncated: false };
    case "tx.begin":
    case "tx.commit":
    case "tx.rollback":
    case "conn.close":
      calls.push(method);
      return { ok: true };
    default:
      return {};
  }
};

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  calls = [];
  transactions = true;
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "sqlite", params: { path: ":memory:" } }]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    if (req.method === "query.run" && String(req.params?.sql) === "SELECT slow") {
      // Held until op.cancel, which makes it fail as an interrupted query does.
      await new Promise<void>((resolve) => (release = resolve));
      return { jsonrpc: "2.0", id: req.id, error: { code: -32001, message: "interrupted" } };
    }
    if (req.method === "op.cancel") {
      calls.push("op.cancel");
      release?.();
    }
    return { jsonrpc: "2.0", id: req.id, result: answer(req.method, req.params ?? {}) };
  };
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

const connect = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  click(host.querySelector(".connbar-add"));
  click(host.querySelector(".connsearch-hit"));
  await settle();
  // Connecting lands on the connection's home (#694); open a query tab.
  openQueryTab(host);
  await settle();
};

const runSql = async (sql: string) => {
  const view = EditorView.findFromDOM(host!)!;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } });
  click(host!.querySelector(".editor-run-main"));
  await settle();
};

const tab = (name: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>('.result-tabs [role="tab"]')].find(
    (b) => b.textContent === name,
  )!;

describe("App — result pane views (#691)", () => {
  it("logs each run under Mensajes and goes back to the result on the next run", async () => {
    await connect();
    expect(tab("Resultado").getAttribute("aria-selected")).toBe("true");
    await runSql("UPDATE t SET a = 1");
    click(tab("Mensajes"));
    expect(tab("Mensajes").getAttribute("aria-selected")).toBe("true");
    expect(host!.querySelector(".result-pane")!.classList.contains("is-alt-view")).toBe(true);
    const lines = [...host!.querySelectorAll(".run-msg")];
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain("1 filas afectadas");
    expect(lines[0].textContent).toContain("UPDATE t SET a = 1");

    await runSql("DELETE FROM t");
    expect(tab("Resultado").getAttribute("aria-selected")).toBe("true");
    click(tab("Mensajes"));
    expect(host!.querySelectorAll(".run-msg")).toHaveLength(2);
  });

  it("shows the plan of the editor's statement in place under Plan", async () => {
    await connect();
    click(tab("Plan"));
    expect(host!.querySelector(".result-pane")!.textContent).toContain("Sin plan");
    click(tab("Resultado"));
    const view = EditorView.findFromDOM(host!)!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "SELECT * FROM t" } });
    click(host!.querySelector('[aria-label^="Más"]'));
    click([...document.querySelectorAll(".context-menu-item")].find((b) => b.textContent?.startsWith("Plan")));
    await settle();
    expect(tab("Plan").getAttribute("aria-selected")).toBe("true");
    expect(host!.querySelector(".result-pane .explain-plan")).not.toBeNull();
    expect(calls.some((c) => c.startsWith("query:EXPLAIN"))).toBe(true);
    // No tool tab was opened for it.
    expect(host!.textContent).not.toContain("Plan de ejecución");
  });

  it("explains only the statement under the cursor, not the whole script (M14)", async () => {
    await connect();
    const view = EditorView.findFromDOM(host!)!;
    const doc = "SELECT 1;\nSELECT * FROM t;\nDELETE FROM t";
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, selection: { anchor: 12 } });
    click(host!.querySelector('[aria-label^="Más"]'));
    click([...document.querySelectorAll(".context-menu-item")].find((b) => b.textContent?.startsWith("Plan")));
    await settle();
    const explains = calls.filter((c) => c.startsWith("query:EXPLAIN"));
    expect(explains.length).toBeGreaterThan(0);
    expect(explains.every((c) => c.includes("SELECT * FROM t") && !c.includes("DELETE"))).toBe(true);
  });

  it("stops the running query on Ctrl+Break (#691)", async () => {
    await connect();
    const ctrlBreak = () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Cancel", ctrlKey: true, bubbles: true }));
    ctrlBreak(); // nothing runs: nothing to stop
    expect(calls).not.toContain("op.cancel");
    const view = EditorView.findFromDOM(host!)!;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "SELECT slow" } });
    click(host!.querySelector(".editor-run-main"));
    await settle();
    expect(host!.querySelector(".editor-stop")!.classList.contains("is-running")).toBe(true);
    ctrlBreak();
    await settle();
    expect(calls).toContain("op.cancel");
    expect(host!.querySelector(".editor-stop")).toBeNull();
    expect(host!.querySelector(".editor-run-main")).not.toBeNull();
  });

  it("says where a write stands and links to its history entry (#691)", async () => {
    await connect();
    await runSql("UPDATE t SET a = 1");
    expect(host!.querySelector(".run-status-text")!.textContent).toContain("confirmado en modo Auto");
    click([...host!.querySelectorAll(".run-status button")].find((b) => b.textContent === "Ver en el historial"));
    await settle();
    const search = host!.querySelector<HTMLInputElement>('.tool-pane input[type="search"]')!;
    expect(search.value).toBe("UPDATE t SET a = 1");
  });
});
