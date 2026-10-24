import { describe, it, expect, afterEach } from "vitest";
import { closeContextMenu, contextMenu } from "../../src/utils/contextMenu";
import type { ResultSet } from "../../src/utils/query";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { RelatedData } from "../../src/components/RelatedData";
import type { RelatedQuery } from "../../src/utils/relatedData";
import { savePaneSize } from "../../src/utils/paneSizes";

// Issue #464: carrying a relationship out to a tab used to close the modal, so
// walking two of them meant reopening it from the cell each time; and the two
// buttons ("abrir en pestaña" / "enviar al editor") landed in the same place.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  // The dialog lives in a Portal, outside the host: disposing the root leaves
  // its container in the body, and the next mount would find both.
  document.querySelectorAll(".dlg-scrim").forEach((n) => n.parentElement?.remove());
});

const query: RelatedQuery = {
  relation: { fromTable: "pedidos", fromColumns: [], toTable: "clientes" },
  label: "pedidos.cliente_id = 7",
  where: "cliente_id = 7",
  columns: [],
} as unknown as RelatedQuery;

const mount = (result: ResultSet | null = null) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  let opened = 0;
  let closed = 0;
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <RelatedData
          table="clientes"
          column="id"
          value="7"
          queries={[query]}
          counts={{ 0: 3 }}
          selected={0}
          onSelect={() => {}}
          sql="SELECT * FROM pedidos WHERE cliente_id = 7"
          keyColumns={[]}
          result={result}
          loading={false}
          error={null}
          truncated={false}
          unsupported={null}
          onOpenTab={() => opened++}
          onClose={() => closed++}
        />
      ),
      host!,
    );
  });
  return { opened: () => opened, closed: () => closed };
};

const actions = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".dlg-f button"));

describe("RelatedData carry-out", () => {
  it("offers one way out, not two", () => {
    mount();
    expect(actions().map((b) => b.textContent)).toEqual(["Abrir en pestaña", "Cerrar"]);
  });

  it("opening a tab leaves the dialog open", () => {
    const { opened, closed } = mount();
    actions()[0].click();
    expect(opened()).toBe(1);
    expect(closed()).toBe(0);
  });
});

// Issue #494: the dialog was 980x88vh and nothing else. It is dragged by its
// corner now (CSS `resize`), and comes back the size it was left at.
describe("RelatedData size", () => {
  it("stays open when a drag that started inside ends on the backdrop", () => {
    const { closed } = mount();
    const backdrop = document.querySelector<HTMLElement>(".dlg-scrim")!;
    const dialog = document.querySelector<HTMLElement>(".related-modal")!;
    // Dragging the resize corner ends past the dialog's edge, and the click that
    // follows is reported on the backdrop.
    dialog.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(closed()).toBe(0);
    // A real click outside still closes it.
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(closed()).toBe(1);
  });

  it("opens at the size it was last left at", () => {
    savePaneSize("relatedW", 1240);
    savePaneSize("relatedH", 700);
    mount();
    const dialog = document.querySelector<HTMLElement>(".related-modal")!;
    expect(dialog.style.width).toBe("1240px");
    expect(dialog.style.height).toBe("700px");
  });
});

// #812: the rows in the dialog can be copied out, as from the main grid.
describe("RelatedData copy", () => {
  const result: ResultSet = {
    columns: [
      { name: "id", type: "int" },
      { name: "login", type: "text" },
    ],
    rows: [
      ["1", "C.CELAYA.CAB"],
      ["2", null],
    ],
  } as ResultSet;

  it("offers the copy menu on a cell, and copies its value or its row", () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (t: string) => void copied.push(t) },
    });
    mount(result);
    const cell = [...document.querySelectorAll<HTMLElement>(".related-result .grid-cell")].find(
      (c) => c.textContent === "C.CELAYA.CAB",
    )!;
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const items = contextMenu()?.items ?? [];
    expect(items.map((i) => i.label)).toEqual([
      "Copiar celda",
      "Copiar fila",
      "Copiar fila con encabezados",
      "Copiar las 2 filas cargadas con encabezados",
    ]);
    items[0].action!();
    items[2].action!();
    items[3].action!();
    closeContextMenu();
    expect(copied).toEqual(["C.CELAYA.CAB", "id\tlogin\n1\tC.CELAYA.CAB", "id\tlogin\n1\tC.CELAYA.CAB\n2\t"]);
  });
});
