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
const txButton = (text: string) =>
  [...host!.querySelectorAll(".tx-controls button")].find((b) => b.textContent === text) as
    | HTMLButtonElement
    | undefined;
// The Auto | Manual radio group (#691): the option to switch to, and the group.
const modeRadio = (name: "Auto" | "Manual") =>
  [...host!.querySelectorAll<HTMLButtonElement>('.tx-mode [role="radio"]')].find(
    (b) => b.textContent === name,
  )!;
const modeSwitch = () => modeRadio("Auto");
const indicator = () => host!.querySelector(".tx-open")?.textContent ?? null;

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

describe("App — manual transactions (issue #667)", () => {
  it("opens a transaction before the first change and commits it from the bar", async () => {
    await connect();
    expect(host!.querySelector(".tx-mode")!.getAttribute("role")).toBe("radiogroup");
    expect(modeRadio("Auto").getAttribute("aria-checked")).toBe("true");
    click(modeRadio("Manual"));
    expect(modeRadio("Manual").getAttribute("aria-checked")).toBe("true");
    expect(modeRadio("Auto").getAttribute("aria-checked")).toBe("false");

    await runSql("UPDATE t SET a = 1");
    expect(calls).toEqual(["tx.begin", "query:UPDATE t SET a = 1"]);
    expect(indicator()).toBe("En transacción · 1");
    expect(host!.querySelector(".status-tx")?.textContent).toBe("En transacción · 1");
    expect(host!.querySelector(".conn-tx")).not.toBeNull();
    // Leaving manual mode now would strand the transaction.
    expect(modeSwitch().disabled).toBe(true);

    calls = [];
    click(txButton("Confirmar"));
    await settle();
    expect(calls).toEqual(["tx.commit"]);
    expect(indicator()).toBeNull();
    expect(modeSwitch().disabled).toBe(false);
  });

  it("keeps the indicator in step with a COMMIT typed in the editor", async () => {
    await connect();
    await runSql("BEGIN");
    expect(calls).toEqual(["tx.begin"]); // tx.begin ran in its place
    expect(indicator()).toBe("En transacción · 0");
    await runSql("COMMIT;");
    expect(calls).toEqual(["tx.begin", "tx.commit"]);
    expect(indicator()).toBeNull();
  });

  it("asks before disconnecting with a transaction open", async () => {
    await connect();
    await runSql("BEGIN");
    calls = [];
    click(host!.querySelector(".connbar-eject"));
    await settle();
    const dialog = document.querySelector(".confirm-dialog");
    expect(dialog?.textContent).toContain("Transacción sin confirmar");
    expect(calls).toEqual([]); // nothing closed yet

    click([...dialog!.querySelectorAll("button")].find((b) => b.textContent === "Revertir"));
    await settle();
    expect(calls).toEqual(["tx.rollback", "conn.close"]);
    expect(document.querySelector(".confirm-dialog")).toBeNull();
  });

  it("disables the switch, with the reason, on an engine without transactions", async () => {
    transactions = false;
    await connect();
    expect(modeSwitch().disabled).toBe(true);
    expect(modeSwitch().title).toBe("Este motor no admite transacciones.");
  });
});
