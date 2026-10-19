import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ObjectListView } from "../../src/components/ObjectListView";

// Drives the real component against a mocked bridge: the object-list SQL returns
// tables + a view with metadata; the grid renders them, the type filter narrows,
// and a double-click opens the row's data.

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}
let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as BridgeHost).quaeroRpc;
});
const flush = () => new Promise((r) => setTimeout(r, 0));

const DEFAULT_ROWS: (string | null)[][] = [
  ["clientes", "table", "1280", "43008", "Cartera"],
  ["pedidos", "table", "61000", "1048576", ""],
  ["v_ventas", "view", null, null, "Resumen"],
];

function installBridge(listRows: (string | null)[][] = DEFAULT_ROWS) {
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string };
    return {
      jsonrpc: "2.0",
      id: req.id,
      result: {
        columns: [
          { name: "nombre", type: "text" },
          { name: "tipo", type: "text" },
          { name: "filas", type: "int" },
          { name: "tamano", type: "int" },
          { name: "comentario", type: "text" },
        ],
        rows: listRows,
        truncated: false,
        rowsAffected: 0,
      },
    };
  };
}

async function mount(onOpenData = vi.fn(), listRows?: (string | null)[][]) {
  installBridge(listRows);
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ObjectListView
          connId="c1"
          engine="mysql"
          db="ventas"
          onOpenData={onOpenData}
          onClose={() => {}}
        />
      ),
      host!,
    );
  });
  await flush();
  return onOpenData;
}

const rows = () => [...host!.querySelectorAll(".objlist-row")];
const rowText = (i: number) => rows()[i]?.textContent ?? "";

describe("ObjectListView", () => {
  it("lists objects with metadata and a formatted size", async () => {
    await mount();
    expect(rows().length).toBe(3);
    expect(rowText(0)).toContain("clientes");
    expect(rowText(0)).toContain("42 KB"); // 43008 bytes formatted
    expect(host!.textContent).toContain("Comentario");
  });

  it("filters by object type via the tab strip", async () => {
    await mount();
    const viewsTab = [...host!.querySelectorAll(".otab")].find((t) =>
      t.textContent?.includes("Vistas"),
    ) as HTMLButtonElement;
    viewsTab.click();
    await flush();
    expect(rows().length).toBe(1);
    expect(rowText(0)).toContain("v_ventas");
  });

  it("opens a row's data on double-click", async () => {
    const onOpenData = await mount();
    rows()[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onOpenData).toHaveBeenCalledWith("pedidos", "table");
  });

  // An engine typing the catalog column as fixed-width CHAR pads the short value
  // ('view ' on Informix, whose CASE is CHAR(5) because of 'table') — issue #315.
  it("counts, filters and opens padded type values as views", async () => {
    const onOpenData = await mount(vi.fn(), [
      ["clientes", "table", "1280", null, null],
      ["v_ventas", "view ", null, null, null],
    ]);
    const viewsTab = [...host!.querySelectorAll(".otab")].find((t) =>
      t.textContent?.includes("Vistas"),
    ) as HTMLButtonElement;
    expect(viewsTab.textContent).toContain("1");
    viewsTab.click();
    await flush();
    expect(rows().length).toBe(1);
    expect(rowText(0)).toContain("v_ventas");
    rows()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onOpenData).toHaveBeenCalledWith("v_ventas", "view");
  });
});

// Issue #719: MongoDB lists its collections and views through getCollectionInfos
// (its own name / type columns), types other than "view" counting as tables.
describe("ObjectListView on MongoDB", () => {
  it("lists collections and views from db.getCollectionInfos()", async () => {
    const sqls: string[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; params: { sql: string } };
      sqls.push(req.params.sql);
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          columns: [
            { name: "name", type: "text" },
            { name: "type", type: "text" },
            { name: "options", type: "json" },
          ],
          rows: [
            ["orders", "collection", "{}"],
            ["metrics", "timeseries", "{}"],
            ["open_orders", "view", "{}"],
          ],
          truncated: false,
          rowsAffected: 0,
        },
      };
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    const onOpenData = vi.fn();
    createRoot((d) => {
      dispose = d;
      render(
        () => <ObjectListView connId="c1" engine="mongodb" db="shop" onOpenData={onOpenData} onClose={() => {}} />,
        host!,
      );
    });
    await flush();
    expect(sqls).toEqual(["db.getCollectionInfos()"]);
    expect(rows().length).toBe(3);
    expect(rowText(0)).toContain("orders");
    // Collections and time-series are tables, a view is a view.
    const viewsTab = [...host!.querySelectorAll(".otab")].find((t) => t.textContent?.includes("Vistas")) as HTMLButtonElement;
    expect(viewsTab.textContent).toContain("1");
    viewsTab.click();
    await flush();
    expect(rows().length).toBe(1);
    rows()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onOpenData).toHaveBeenCalledWith("open_orders", "view");
  });
});

// The toolbar, Triggers tab, keyboard and footer of the M14 object list.
describe("ObjectListView toolbar and keys", () => {
  const mountSqlite = (props: Record<string, unknown> = {}) => {
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; params: { sql: string } };
      const sql = req.params.sql;
      const res = (cols: string[], rows: (string | null)[][]) => ({
        jsonrpc: "2.0",
        id: req.id,
        result: { columns: cols.map((name) => ({ name, type: "text" })), rows, truncated: false, rowsAffected: 0 },
      });
      if (sql.includes("type = 'trigger'") && sql.includes("LIMIT 1"))
        return res(["sql"], [["CREATE TRIGGER trg AFTER INSERT ON pedidos BEGIN SELECT 1; END"]]);
      if (sql.includes("type = 'trigger'")) return res(["name", "table", "sql"], [["trg", "pedidos", "CREATE TRIGGER trg"]]);
      return res(["nombre", "tipo", "columnas", "indices"], [
        ["clientes", "table", "7", "2"],
        ["pedidos", "table", "5", "1"],
        ["v_ventas", "view", "3", null],
      ]);
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    const cbs = { onOpenData: vi.fn(), onOpenStructure: vi.fn(), onNewTable: vi.fn(), onOpenSql: vi.fn(), ...props };
    createRoot((d) => {
      dispose = d;
      render(() => <ObjectListView connId="c1" engine="sqlite" db="main" onClose={() => {}} {...cbs} />, host!);
    });
    return cbs;
  };

  it("counts every kind in the tabs and the footer, with column and index counts", async () => {
    mountSqlite();
    await flush();
    await flush();
    const tabs = [...host!.querySelectorAll(".otab")].map((b) => b.textContent);
    expect(tabs).toEqual(["Todos 4", "Tablas 2", "Vistas 1", "Triggers 1"]);
    expect(host!.querySelector(".objlist-foot")!.textContent).toContain("4 objetos · 2 tablas · 1 vista · 1 trigger");
    expect(rowText(0)).toContain("7");
    expect(rowText(3)).toContain("en pedidos");
  });

  it("filters by name", async () => {
    mountSqlite();
    await flush();
    await flush();
    const input = host!.querySelector(".objlist-filter") as HTMLInputElement;
    input.value = "PED";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(rows().map((r) => r.querySelector(".objlist-name")!.textContent)).toEqual(["pedidos"]);
  });

  it("moves with the arrows, opens the data with Intro and the structure with F12", async () => {
    const cbs = mountSqlite();
    await flush();
    await flush();
    const key = (i: number, k: string) => rows()[i].dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key(0, "ArrowDown");
    expect(rows()[1].getAttribute("aria-selected")).toBe("true");
    key(1, "Enter");
    expect(cbs.onOpenData).toHaveBeenCalledWith("pedidos", "table");
    key(1, "F12");
    expect(cbs.onOpenStructure).toHaveBeenCalledWith("pedidos", "table");
  });

  it("opens a trigger's definition in the editor", async () => {
    const cbs = mountSqlite();
    await flush();
    await flush();
    rows()[3].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush();
    expect(cbs.onOpenSql).toHaveBeenCalledWith("CREATE TRIGGER trg AFTER INSERT ON pedidos BEGIN SELECT 1; END");
    expect(cbs.onOpenData).not.toHaveBeenCalled();
  });

  it("offers Nueva tabla", async () => {
    const cbs = mountSqlite();
    await flush();
    const btn = [...host!.querySelectorAll("button")].find((b) => b.textContent?.includes("Nueva tabla")) as HTMLButtonElement;
    btn.click();
    expect(cbs.onNewTable).toHaveBeenCalled();
  });
});
