import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ObjectTree } from "../../src/components/ObjectTree";
import { ContextMenu } from "../../src/components/ContextMenu";
import { contextMenu, closeContextMenu, type MenuItem } from "../../src/utils/contextMenu";


// A table's own levels and its menu (audit A-16, A-17, R-35): expanding a table
// lists its columns (type, PK, FK), its indexes and its foreign keys; its menu
// has a header, «Generar SQL ▸», and a danger zone with «Vaciar tabla…».

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
let calls: { method: string; params: Record<string, unknown> }[] = [];

// jsdom lays nothing out: give the tree a viewport, or the virtual window
// holds only its overscan rows.
const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
});
afterAll(() => {
  if (height) Object.defineProperty(HTMLElement.prototype, "clientHeight", height);
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as BridgeHost).quaeroRpc;
  closeContextMenu();
});

const settle = async () => {
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const rs = (cols: string[], rows: (string | null)[][]) => ({
  columns: cols.map((name) => ({ name, type: "text" })),
  rows,
  truncated: false,
  rowsAffected: 0,
});

function answer(method: string, params: Record<string, unknown>) {
  if (method === "schema.tree") {
    return params.db ? rs(["name", "type"], [["pedidos", "table"]]) : rs(["name"], [["ventas"]]);
  }
  if (method === "schema.describe") {
    return rs(
      ["name", "type", "notnull", "dflt_value", "pk"],
      [
        ["id", "int", "1", null, "1"],
        ["cliente_id", "int", "1", null, "0"],
      ],
    );
  }
  if (method === "schema.ddl") return rs(["sql"], [["CREATE TABLE pedidos (id int)"]]);
  const sql = String(params.sql ?? "");
  if (sql.includes("TABLE_ROWS")) return rs(["name", "n"], [["pedidos", "1234"]]);
  if (sql.includes("STATISTICS")) return rs(["name", "columnas", "unico"], [["PRIMARY", "id", "Sí"]]);
  if (sql.includes("KEY_COLUMN_USAGE"))
    return rs(
      ["from_table", "from_column", "to_table", "to_column", "constraint_name", "position"],
      [["pedidos", "cliente_id", "clientes", "id", "fk_cliente", "1"]],
    );
  return rs([], []);
}

function mount(extra: Record<string, unknown> = {}) {
  calls = [];
  (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> };
    calls.push({ method: req.method, params: req.params });
    return { jsonrpc: "2.0", id: req.id, result: answer(req.method, req.params) };
  };
  const h = {
    onOpenData: vi.fn(),
    onOpenStructure: vi.fn(),
    onOpenSql: vi.fn(),
    onAlterTable: vi.fn(),
    onColumns: vi.fn(),
    onRowCounts: vi.fn(),
    onRefresh: vi.fn(),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <>
          <ObjectTree connId="c1" engine="mysql" title="Ventas" {...h} {...extra} />
          <ContextMenu />
        </>
      ),
      host!,
    );
  });
  return h;
}

const row = (label: string) =>
  [...host!.querySelectorAll<HTMLElement>(".objtree-row")].find((r) => r.getAttribute("aria-label") === label);
const labels = () => [...host!.querySelectorAll(".objtree-row")].map((r) => r.getAttribute("aria-label"));

/** Open ventas › Tablas: the table row is then on screen. */
async function openTables() {
  await settle();
  row("ventas")!.click();
  await settle();
  row("Tablas")!.click();
  await settle();
}

describe("ObjectTree — a table's levels (audit A-16)", () => {
  it("shows the catalog's row count beside the table (R-35)", async () => {
    const h = mount();
    await openTables();
    expect(row("pedidos")!.querySelector(".objtree-meta")!.textContent).toBe("1234 filas");
    expect(h.onRowCounts).toHaveBeenCalledWith({ pedidos: 1234 });
  });

  it("opens the data on a click and expands on its caret, into columns, indexes and keys", async () => {
    const h = mount();
    await openTables();
    row("pedidos")!.click();
    expect(h.onOpenData).toHaveBeenCalledOnce();
    expect(labels()).not.toContain("id");

    (row("pedidos")!.querySelector(".objtree-caret") as HTMLElement).click();
    await settle();
    expect(h.onOpenData).toHaveBeenCalledOnce(); // the caret only expands
    expect(labels().slice(0, 7)).toEqual(["ventas", "Tablas", "pedidos", "id", "cliente_id", "Índices", "Claves foráneas"]);
    expect(row("id")!.querySelector(".objtree-meta")!.textContent).toBe("int");
    expect(row("id")!.querySelector(".kind-key")).not.toBeNull();
    expect(row("cliente_id")!.querySelector(".kind-fk")).not.toBeNull();
    // The autocomplete learns the columns.
    expect(h.onColumns).toHaveBeenCalledWith("pedidos", ["id", "cliente_id"]);

    row("Claves foráneas")!.click();
    await settle();
    expect(row("fk_cliente")!.querySelector(".objtree-meta")!.textContent).toBe("cliente_id → clientes(id)");
  });

  it("expands with the right arrow and opens with Enter", async () => {
    const h = mount();
    await openTables();
    const tree = host!.querySelector<HTMLElement>("[role=tree]")!;
    const key = (k: string, extra: KeyboardEventInit = {}) =>
      tree.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));
    key("Home");
    key("ArrowDown");
    key("ArrowDown"); // ventas › Tablas › pedidos
    key("ArrowRight");
    await settle();
    expect(labels()).toContain("cliente_id");
    key("Enter");
    expect(h.onOpenData).toHaveBeenCalledWith(expect.objectContaining({ label: "pedidos" }));
    key("F4");
    expect(h.onAlterTable).toHaveBeenCalledWith(expect.objectContaining({ label: "pedidos" }));
  });
});

describe("ObjectTree — the table menu (audit A-17)", () => {
  const openMenu = () => {
    row("pedidos")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return contextMenu()!.items;
  };
  const item = (items: MenuItem[], label: string) => items.find((i) => i.label === label)!;

  it("names the table, shows the keys, and keeps the danger zone last", async () => {
    mount();
    await openTables();
    const items = openMenu();
    expect(items[0]).toMatchObject({ heading: true, label: "pedidos · tabla de Ventas" });
    expect(item(items, "Abrir datos").hint).toBe("Intro");
    expect(item(items, "Modificar tabla").hint).toBe("F4");
    const zone = items.findIndex((i) => i.heading && i.label === "Zona de peligro");
    expect(items.slice(zone + 1).map((i) => i.label)).toEqual(["Vaciar tabla…", "Eliminar…"]);
    expect(items.slice(zone + 1).every((i) => i.danger)).toBe(true);
  });

  it("writes a new query on the table without running it", async () => {
    const h = mount();
    await openTables();
    item(openMenu(), "Nueva consulta sobre pedidos").action!();
    expect(h.onOpenSql).toHaveBeenCalledWith("SELECT *\nFROM `ventas`.`pedidos`;", "pedidos");
    expect(calls.some((c) => c.method === "query.run" && String(c.params.sql).includes("SELECT *"))).toBe(false);
  });

  it("generates an UPDATE by the primary key from «Generar SQL ▸»", async () => {
    const h = mount();
    await openTables();
    const gen = item(openMenu(), "Generar SQL");
    expect(gen.submenu!.map((i) => i.label)).toEqual([
      "SELECT en una consulta nueva",
      "INSERT",
      "UPDATE",
      "DELETE",
      undefined,
      "CREATE TABLE (DDL)",
    ]);
    item(gen.submenu!, "UPDATE").action!();
    await settle();
    expect(h.onOpenSql).toHaveBeenCalledWith(
      "UPDATE `ventas`.`pedidos`\nSET `cliente_id` = :cliente_id\nWHERE `id` = :id;",
      "pedidos",
    );
  });

  it("empties the table only through its confirmation, showing the TRUNCATE", async () => {
    const h = mount();
    await openTables();
    item(openMenu(), "Vaciar tabla…").action!();
    await settle();
    const dialog = host!.querySelector("[role=alertdialog], [role=dialog]")!;
    expect(dialog.textContent).toContain("¿Vaciar la tabla pedidos?");
    expect(dialog.textContent).toContain("TRUNCATE TABLE `ventas`.`pedidos`");
    expect(calls.some((c) => String(c.params.sql ?? "").startsWith("TRUNCATE"))).toBe(false);
    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Vaciar tabla")!;
    confirm.click();
    await settle();
    expect(calls.some((c) => c.params.sql === "TRUNCATE TABLE `ventas`.`pedidos`")).toBe(true);
    expect(h.onRefresh).toHaveBeenCalled();
  });

  it("asks for the table's name on a protected connection", async () => {
    mount({ conn: { driver: "mysql", sub: "", focused: true, safeMode: "confirm" } });
    await openTables();
    item(openMenu(), "Vaciar tabla…").action!();
    await settle();
    const dialog = host!.querySelector("[role=alertdialog], [role=dialog]")!;
    const confirm = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Vaciar tabla")!;
    expect(confirm.disabled).toBe(true);
  });

  it("offers the connection's menu on a database node and on its header", async () => {
    const connMenu = vi.fn((db?: string): MenuItem[] => [{ label: `menu ${db ?? "conn"}`, action: () => {} }]);
    mount({ connMenu, conn: { driver: "mysql", sub: "", focused: true } });
    await settle();
    row("ventas")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(contextMenu()!.items[0].label).toBe("menu ventas");
    host!.querySelector(".objtree-header")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(contextMenu()!.items[0].label).toBe("menu conn");
  });
});

describe("ObjectTree — loading", () => {
  it("draws skeleton rows while the first level loads", async () => {
    (globalThis as BridgeHost).quaeroRpc = () => new Promise(() => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <ObjectTree connId="c1" onOpenData={() => {}} onOpenStructure={() => {}} />, host!);
    });
    await settle();
    const sk = host.querySelector(".objtree-skeleton")!;
    expect(sk.getAttribute("aria-busy")).toBe("true");
    expect(sk.querySelectorAll(".objtree-skeleton-row").length).toBeGreaterThan(3);
  });
});

