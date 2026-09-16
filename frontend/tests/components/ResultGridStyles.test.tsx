import { describe, it, expect, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ResultGrid } from "../../src/components/ResultGrid";
import type { ResultSet } from "../../src/utils/query";
import type { GridStyle } from "../../src/utils/settings";

// The three grid styles as the grid actually draws them (issue #540).
//
// The case that matters most here is the last one: the report style shows
// "1,250.00" and the cell must still HOLD 1250.00, because every path that
// copies, filters, exports or edits reads the raw rows. A formatted value
// leaking out of the grid would be a data bug dressed as typography.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const result: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "nombre", type: "text" },
    { name: "saldo", type: "float" },
    { name: "alta", type: "date" },
  ],
  rows: [
    ["1", "María López", "1250.00", "2023-02-14"],
    ["2", "Ana Gómez", null, "2024-01-09"],
  ],
  truncated: false,
  rowsAffected: 0,
};

function mount(style: GridStyle) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const [gridStyle, setGridStyle] = createSignal<GridStyle>(style);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ResultGrid
          result={result}
          loading={false}
          error={null}
          gridStyle={gridStyle()}
          keyColumns={["id"]}
        />
      ),
      host!,
    );
  });
  return { setGridStyle };
}

/** A data cell, by its row and original column index. */
const cell = (r: number, c: number) =>
  host!.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`)!;

describe("grid styles", () => {
  it("shows the raw value in Registro", () => {
    mount("registro");
    expect(cell(0, 2).textContent).toBe("1250.00");
    expect(cell(0, 3).textContent).toBe("2023-02-14");
  });

  it("shows the raw value in Hoja densa", () => {
    mount("hoja");
    expect(cell(0, 2).textContent).toBe("1250.00");
    expect(cell(0, 3).textContent).toBe("2023-02-14");
  });

  it("formats numbers and dates in Informe", () => {
    mount("informe");
    expect(cell(0, 2).textContent).toBe("1,250.00");
    expect(cell(0, 3).textContent).toBe("14 feb 2023");
  });

  it("leaves text alone in Informe", () => {
    mount("informe");
    expect(cell(0, 1).textContent).toBe("María López");
  });

  // The guarantee the whole change rests on.
  it("keeps the RAW value in the cell's tooltip, whatever it shows", () => {
    mount("informe");
    expect(cell(0, 2).title).toBe("1250.00");
    expect(cell(0, 3).title).toBe("2023-02-14");
  });

  it("switches style without reloading the result", () => {
    const { setGridStyle } = mount("registro");
    expect(cell(0, 2).textContent).toBe("1250.00");
    setGridStyle("informe");
    expect(cell(0, 2).textContent).toBe("1,250.00");
    // Same rows, still two of them: nothing was re-fetched or dropped.
    expect(host!.querySelectorAll(".grid-rows .grid-row").length).toBe(2);
  });

  it("draws NULL as a tag, not as a word among the data", () => {
    mount("registro");
    const nullCell = cell(1, 2);
    expect(nullCell.querySelector(".cell-null-tag")).not.toBeNull();
    expect(nullCell.textContent).toBe("NULL");
  });

  // 🔑 painted itself yellow in every theme and ignored the header's colour.
  it("marks the key column with a drawn icon that keeps its accessible name", () => {
    mount("registro");
    const key = host!.querySelector(".col-key-mark")!;
    expect(key.querySelector("svg")).not.toBeNull();
    expect(key.textContent).not.toContain("🔑");
    expect(key.querySelector(".visually-hidden")!.textContent).toBeTruthy();
  });
});
