import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";
import { openQueryTab } from "./appHelpers";

// Deleting rows from the grid (audit P1, rule 7): the saved plan's apply button
// turns red, and a confirmation names the table, each row by its key and the
// tables whose foreign keys point at it before any DELETE runs.

type Rpc = { method: string; params: Record<string, unknown> };
let sent: Rpc[] = [];

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
      return rs([["name", "text"]], [["testdb"]]);
    case "schema.describe":
      return rs(
        [["name", "text"], ["type", "text"], ["pk", "int"]],
        [["id", "int", "1"], ["nombre", "text", "0"]],
      );
    case "row.delete":
      return { sql: "DELETE FROM `clientes` WHERE `id` = 2", rowsAffected: 1 };
    case "query.run":
      if (sql.includes("KEY_COLUMN_USAGE")) {
        // Inbound: pedidos.cliente_id references clientes.id.
        return sql.includes("REFERENCED_TABLE_NAME = 'clientes'")
          ? rs(
              [["from_table", "text"], ["from_column", "text"], ["to_table", "text"], ["to_column", "text"]],
              [["pedidos", "cliente_id", "clientes", "id"]],
            )
          : rs([["from_table", "text"]], []);
      }
      if (sql.includes("clientes")) {
        return rs([["id", "int"], ["nombre", "text"]], [["1", "ana"], ["2", "beto"]]);
      }
      return rs([], []);
    default:
      return {};
  }
};

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  sent = [];
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "mysql", params: { host: "127.0.0.1" } }]),
  );
  localStorage.setItem(
    "quaero.history",
    JSON.stringify([{ sql: "SELECT * FROM clientes", ts: Date.now(), connId: "k1", connName: "local" }]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    sent.push({ method: req.method, params: req.params ?? {} });
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
const byText = (sel: string, text: string) =>
  [...document.querySelectorAll<HTMLElement>(sel)].find((b) => b.textContent?.includes(text));
const deletes = (preview: boolean) =>
  sent.filter((r) => r.method === "row.delete" && !!r.params.preview === preview);

describe("App — deleting rows asks first, naming them", () => {
  it("names the table, the rows and the dependants before the DELETE runs", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <App />, host!);
    });
    click(host.querySelector(".connbar-add"));
    click(host.querySelector(".connsearch-hit"));
    await settle();
    openQueryTab(host);
    await settle();
    click(host.querySelector(".empty-sql"));
    await settle();
    expect(host.querySelectorAll(".grid-rows .grid-row").length).toBe(2);

    // Edit in place, then delete the second row.
    host.querySelector('[data-cell="1-1"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    click(host.querySelectorAll('.grid-rows button[aria-label="Eliminar fila"]')[1]);
    await settle();

    // Save: the SQL preview comes up with a red, counted button.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    await settle();
    const apply = byText(".edit-preview button", "Aplicar y eliminar 1 fila")!;
    expect(apply, "the apply button names the deletion").toBeTruthy();
    expect(apply.classList.contains("btn-danger")).toBe(true);
    click(apply);
    await settle();

    const dlg = document.querySelector('[role="alertdialog"]')!;
    expect(dlg.textContent).toContain("¿Eliminar 1 fila de clientes?");
    expect(dlg.textContent).toContain("id 2");
    expect(dlg.textContent).toContain("pedidos.cliente_id");
    expect(deletes(false)).toHaveLength(0);

    click(dlg.querySelector(".btn-danger"));
    await settle();
    expect(deletes(false)).toHaveLength(1);
  });
});
