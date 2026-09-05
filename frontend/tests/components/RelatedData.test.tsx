import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { RelatedData } from "../../src/components/RelatedData";
import type { RelatedQuery } from "../../src/utils/relatedData";

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
  document.querySelectorAll(".modal-backdrop").forEach((n) => n.parentElement?.remove());
});

const query: RelatedQuery = {
  relation: { fromTable: "pedidos", fromColumns: [], toTable: "clientes" },
  label: "pedidos.cliente_id = 7",
  where: "cliente_id = 7",
  columns: [],
} as unknown as RelatedQuery;

const mount = () => {
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
          result={null}
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
  Array.from(document.querySelectorAll<HTMLButtonElement>(".related-actions button"));

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
