import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Integration: the foreign-key picker as a user actually reaches it — connect,
// run a query over a table, press "Editar", and expect the FK column to offer
// the referenced table's rows. The unit tests cover the pieces (utils/fkLookup,
// ResultGrid, RowDetail); this one covers the WIRING between them, which is
// exactly where the picker failed to appear in the real app.
//
// The core is faked at the bridge (globalThis.quaeroRpc), the same seam the
// webview binds — so App runs unmodified: real stores, real memos, real IPC
// shapes (see docs/IPC.md).

interface Rpc {
  method: string;
  params: Record<string, unknown>;
}

/** Every RPC the App sent, so a test can assert what the core was asked for. */
let sent: Rpc[] = [];

const rs = (columns: [string, string][], rows: (string | null)[][]) => ({
  columns: columns.map(([name, type]) => ({ name, type })),
  rows,
  rowsAffected: rows.length,
  truncated: false,
});

// testdb: pedidos(id PK, cliente_id -> Clientes.id, total), Clientes(id, nombre).
const answer = (method: string, params: Record<string, unknown>): unknown => {
  const sql = String(params.sql ?? "");
  switch (method) {
    case "conn.open":
      return { connId: "c1" };
    case "schema.tree":
      // Top level: the databases. Inside one: its tables (a `type` column makes
      // the core's answer a table listing — see utils/schema#parseTreeRows).
      return params.db
        ? rs([["name", "text"], ["type", "text"]], [["Clientes", "table"], ["pedidos", "table"]])
        : rs([["name", "text"]], [["testdb"]]);
    case "tx.begin":
    case "tx.commit":
    case "tx.rollback":
      return {};
    case "schema.describe":
      // pedidos: id is the primary key; the FK column is not.
      return rs(
        [["name", "text"], ["type", "text"], ["pk", "int"]],
        [
          ["id", "int", "1"],
          ["cliente_id", "int", "0"],
          ["total", "float", "0"],
        ],
      );
    case "query.run": {
      if (sql.includes("KEY_COLUMN_USAGE")) {
        // A real schema has thousands of foreign keys and query.run caps the rows
        // it returns (IPC_QUERY_DEFAULT_LIMIT = 1000). An UNSCOPED listing loses
        // its tail, and with it the table being edited — the bug that left
        // LG_Documento without a picker. So: only a table-scoped query answers.
        if (!sql.includes("TABLE_NAME = 'pedidos'")) {
          const noise: (string | null)[][] = Array.from({ length: 1000 }, (_, i) => [
            `otra_${i}`,
            "x_id",
            "otra",
            "id",
          ]);
          return rs(
            [["from_table", "text"], ["from_column", "text"], ["to_table", "text"], ["to_column", "text"]],
            noise, // pedidos would be past the cap, exactly as in the real database
          );
        }
        return rs(
          [["from_table", "text"], ["from_column", "text"], ["to_table", "text"], ["to_column", "text"]],
          [["pedidos", "cliente_id", "Clientes", "id"]],
        );
      }
      if (sql.includes("Clientes")) {
        return rs(
          [["id", "int"], ["nombre", "text"]],
          [
            ["1", "Ferretería López"],
            ["2", "Aceros del Norte"],
          ],
        );
      }
      if (sql.includes("pedidos")) {
        return rs(
          [["id", "int"], ["cliente_id", "int"], ["total", "float"]],
          [["1", "1", "1520.50"]],
        );
      }
      return rs([], []);
    }
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
  // The empty state offers the history, which runs a query without driving CodeMirror.
  localStorage.setItem(
    "quaero.history",
    JSON.stringify([
      { sql: "SELECT * FROM pedidos", ts: Date.now(), connId: "k1", connName: "local" },
    ]),
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

/** Let every pending microtask/promise chain settle (the App's IPC is async). */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const click = (el: Element | null | undefined) => (el as HTMLElement).click();
const byText = (sel: string, text: string) =>
  [...host!.querySelectorAll(sel)].find((b) => b.textContent?.trim() === text);

/** The `nombre` column of every row the open FK dialog is showing. The dialog is
    portalled to <body>, so it is read from the document, not from the grid. */
const pickedLabels = () =>
  [...document.querySelectorAll(".fk-browser tbody tr")].map(
    (tr) => tr.querySelectorAll("td")[2]?.textContent,
  );

describe("App — the foreign-key picker, end to end", () => {
  it("offers the referenced table's rows on the FK column after Editar", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <App />, host!);
    });

    // Connect (the connections popover lists the saved connection).
    click(host.querySelector(".connbar-active"));
    click(host.querySelector(".conn-list .conn-open"));
    await settle();

    // Run a plain single-table query from the empty state's history.
    click(host.querySelector(".empty-history button, .empty-state button"));
    await settle();
    expect(host.querySelectorAll(".grid-rows .grid-row").length).toBe(1);

    // The query is over one table with its PK projected, so it is editable
    // (issue #299) — the toolbar offers Editar.
    const edit = byText("button", "✎ Editar");
    expect(edit, "the grid should be editable after a single-table SELECT").toBeTruthy();
    click(edit);
    await settle();

    // The FK column (cliente_id) now has a picker; the others are plain inputs.
    const toggles = host.querySelectorAll<HTMLButtonElement>(".grid-rows .fk-toggle");
    expect(toggles.length, "the FK column should offer a picker").toBe(1);

    // And it opens the rows of Clientes — whole rows, so one can be recognised.
    toggles[0].click();
    expect(pickedLabels()).toEqual(["Ferretería López", "Aceros del Norte"]);
    // Picking one writes its key into the cell.
    document.querySelectorAll<HTMLButtonElement>(".fk-browser .fk-pick")[1].click();
    await settle();
    const cell = host.querySelector<HTMLInputElement>(".grid-rows .fk-value")!;
    expect(cell.value).toBe("2");
  });

  // The path a user actually takes: open the table from the object tree. It
  // reaches the grid through runPreviewPage (a paged preview), not through run().
  it("offers the picker on a table opened from the tree", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <App />, host!);
    });

    click(host.querySelector(".connbar-active"));
    click(host.querySelector(".conn-list .conn-open"));
    await settle();

    // Expand the database, then open the table.
    const dbRow = [...host.querySelectorAll(".objtree-row")].find((r) =>
      r.textContent?.includes("testdb"),
    );
    click(dbRow);
    await settle();
    // Tables hang from a "Tablas" group inside the database.
    const group = [...host.querySelectorAll(".objtree-row")].find((r) =>
      r.textContent?.includes("Tablas"),
    );
    click(group);
    await settle();
    const tableRow = [...host.querySelectorAll(".objtree-row")].find((r) =>
      r.textContent?.includes("pedidos"),
    );
    expect(tableRow, "the tree should list the table").toBeTruthy();
    click(tableRow);
    await settle();

    const edit = byText("button", "✎ Editar");
    expect(edit, "a table opened from the tree is editable").toBeTruthy();
    click(edit);
    await settle();

    const toggles = host.querySelectorAll<HTMLButtonElement>(".grid-rows .fk-toggle");
    expect(toggles.length, "the FK column should offer a picker").toBe(1);
    toggles[0].click();
    expect(pickedLabels()).toEqual(["Ferretería López", "Aceros del Norte"]);
  });
});
