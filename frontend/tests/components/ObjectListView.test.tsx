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
