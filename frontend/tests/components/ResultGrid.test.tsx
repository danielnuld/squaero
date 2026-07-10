import { describe, it, expect, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ResultGrid } from "../../src/components/ResultGrid";
import type { ResultSet } from "../../src/utils/query";
import {
  emptyPending,
  setCell,
  toggleDelete,
  setInsertCell,
  addInsert,
  type PendingChanges,
} from "../../src/utils/editSession";

// Drives the real ResultGrid in edit mode (jsdom): typing in a cell, toggling a
// row delete, and editing an inserted row exercise the component's edit wiring
// end to end — the interactive grid a user meets, not a stub.

const result: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
  ],
  rows: [
    ["1", "alice"],
    ["2", "bob"],
  ],
  truncated: false,
  rowsAffected: 0,
};

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

/** Mount ResultGrid in edit mode over `result`, with pending changes held in a
    signal so the grid re-renders as a user's edits accumulate. */
function mountEditable(initial: PendingChanges = emptyPending()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const [pending, setPending] = createSignal(initial);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ResultGrid
          result={result}
          loading={false}
          error={null}
          edit={{
            active: true,
            pending: pending(),
            onEditCell: (r, c, v) => setPending((p) => setCell(p, r, c, v)),
            onToggleDelete: (r) => setPending((p) => toggleDelete(p, r)),
            onInsertCell: (i, c, v) => setPending((p) => setInsertCell(p, i, c, v)),
            onRemoveInsert: () => {},
          }}
        />
      ),
      host!,
    );
  });
  return { pending };
}

/** Set an input's value and fire the `input` event Solid listens for. */
function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ResultGrid edit mode", () => {
  it("renders editable inputs for every cell", () => {
    mountEditable();
    const inputs = host!.querySelectorAll<HTMLInputElement>(".cell-input");
    // 2 rows x 2 columns.
    expect(inputs.length).toBe(4);
    expect(inputs[0].value).toBe("1");
    expect(inputs[1].value).toBe("alice");
  });

  it("records a cell edit and reflects it in the input", () => {
    const { pending } = mountEditable();
    const inputs = host!.querySelectorAll<HTMLInputElement>(".cell-input");
    type(inputs[1], "robert"); // row 0, column "name"
    expect(pending().edits).toEqual({ 0: { name: "robert" } });
    // After the edit, the grid shows the pending value.
    const after = host!.querySelectorAll<HTMLInputElement>(".cell-input");
    expect(after[1].value).toBe("robert");
  });

  it("toggles a row for deletion, marking it and disabling its inputs", () => {
    const { pending } = mountEditable();
    const del = host!.querySelector<HTMLButtonElement>("button.grid-action.danger")!;
    del.click();
    expect(pending().deletes).toEqual([0]);
    expect(host!.querySelector(".row-deleted")).not.toBeNull();
    const firstRowInputs = host!
      .querySelectorAll(".grid-row")[0]
      .querySelectorAll<HTMLInputElement>(".cell-input");
    expect(firstRowInputs[0].disabled).toBe(true);
  });

  it("renders inserted rows and edits their cells", () => {
    let seed = addInsert(emptyPending());
    const { pending } = mountEditable(seed);
    const insertRow = host!.querySelector(".row-insert");
    expect(insertRow).not.toBeNull();
    const insInputs = insertRow!.querySelectorAll<HTMLInputElement>(".cell-input");
    expect(insInputs.length).toBe(2);
    type(insInputs[0], "9"); // insert 0, column "id"
    expect(pending().inserts).toEqual([{ id: "9" }]);
  });

  it("keeps cell edits keyed by original row index after sorting", () => {
    const sortable: ResultSet = {
      columns: [
        { name: "id", type: "int" },
        { name: "name", type: "text" },
      ],
      rows: [
        ["2", "a"],
        ["1", "b"],
      ],
      truncated: false,
      rowsAffected: 0,
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    const [pending, setPending] = createSignal(emptyPending());
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ResultGrid
            result={sortable}
            loading={false}
            error={null}
            edit={{
              active: true,
              pending: pending(),
              onEditCell: (r, c, v) => setPending((p) => setCell(p, r, c, v)),
              onToggleDelete: () => {},
              onInsertCell: () => {},
              onRemoveInsert: () => {},
            }}
          />
        ),
        host!,
      );
    });
    // Sort ascending by id -> displayed order is original row 1 ("1"), then 0 ("2").
    host!.querySelectorAll<HTMLDivElement>(".grid-head-sort")[0].click();
    const firstRow = host!.querySelectorAll(".grid-rows .grid-row")[0];
    const nameInput = firstRow.querySelectorAll<HTMLInputElement>(".cell-input")[1];
    expect(nameInput.value).toBe("b"); // original row 1 is displayed first
    type(nameInput, "B!");
    // The edit is recorded against original index 1, not display position 0.
    expect(pending().edits).toEqual({ 1: { name: "B!" } });
  });

  it("shows a bool input as 0/1 but keeps a NULL bool empty (not 0)", () => {
    const boolRes: ResultSet = {
      columns: [
        { name: "id", type: "int" },
        { name: "activo", type: "bool" },
      ],
      rows: [
        ["1", "true"],
        ["2", null],
      ],
      truncated: false,
      rowsAffected: 0,
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    const [pending] = createSignal(emptyPending());
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ResultGrid
            result={boolRes}
            loading={false}
            error={null}
            edit={{
              active: true,
              pending: pending(),
              onEditCell: () => {},
              onToggleDelete: () => {},
              onInsertCell: () => {},
              onRemoveInsert: () => {},
            }}
          />
        ),
        host!,
      );
    });
    const inputs = host!.querySelectorAll<HTMLInputElement>(".grid-rows .cell-input");
    expect(inputs[1].value).toBe("1"); // row 0 activo=true -> 1
    expect(inputs[3].value).toBe(""); // row 1 activo=NULL -> empty, not "0"
  });

  it("is read-only (no inputs) when edit is inactive", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => <ResultGrid result={result} loading={false} error={null} />,
        host!,
      );
    });
    expect(host.querySelectorAll(".cell-input").length).toBe(0);
    // Values render as plain text cells instead.
    expect(host.textContent).toContain("alice");
  });
});

describe("ResultGrid sort + filter (issue #132)", () => {
  const numeric: ResultSet = {
    columns: [
      { name: "id", type: "int" },
      { name: "name", type: "text" },
    ],
    rows: [
      ["2", "x"],
      ["10", "y"],
      ["1", "z"],
    ],
    truncated: false,
    rowsAffected: 0,
  };

  function mountReadonly(result: ResultSet) {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <ResultGrid result={result} loading={false} error={null} />, host!);
    });
  }

  const colValues = (c: number) =>
    [...host!.querySelectorAll(".grid-rows .grid-row")].map(
      (r) => r.querySelectorAll(".grid-cell")[c].textContent,
    );

  it("cycles a column sort none -> asc -> desc -> none, numerically", () => {
    mountReadonly(numeric);
    const head = host!.querySelectorAll<HTMLDivElement>(".grid-head-sort")[0];
    expect(colValues(0)).toEqual(["2", "10", "1"]); // original order
    head.click();
    expect(colValues(0)).toEqual(["1", "2", "10"]); // asc, numeric (not lexical)
    head.click();
    expect(colValues(0)).toEqual(["10", "2", "1"]); // desc
    head.click();
    expect(colValues(0)).toEqual(["2", "10", "1"]); // back to none
  });

  it("filters rows by a per-column substring", () => {
    mountReadonly(numeric);
    const filter = host!.querySelectorAll<HTMLInputElement>(".grid-filter-input")[1];
    type(filter, "y");
    expect(colValues(1)).toEqual(["y"]);
  });

  it("shows a no-match note when the filter excludes every loaded row", () => {
    mountReadonly(numeric);
    const filter = host!.querySelectorAll<HTMLInputElement>(".grid-filter-input")[1];
    type(filter, "zzz");
    expect(host!.querySelector(".grid-empty-filter")).not.toBeNull();
  });

  it("re-renders fresh values when the result is replaced in place (same size)", () => {
    // Guards against the index-keyed <For> reusing a stale row snapshot when a
    // new query returns a result of the same length in the same mounted grid.
    host = document.createElement("div");
    document.body.appendChild(host);
    const first: ResultSet = {
      columns: [{ name: "city", type: "text" }],
      rows: [["Hermosillo"], ["Guaymas"]],
      truncated: false,
      rowsAffected: 0,
    };
    const second: ResultSet = {
      columns: [{ name: "city", type: "text" }],
      rows: [["Nogales"], ["Obregon"]],
      truncated: false,
      rowsAffected: 0,
    };
    const [result, setResult] = createSignal<ResultSet>(first);
    createRoot((d) => {
      dispose = d;
      render(() => <ResultGrid result={result()} loading={false} error={null} />, host!);
    });
    expect(host!.textContent).toContain("Hermosillo");
    setResult(second);
    expect(host!.textContent).toContain("Nogales");
    expect(host!.textContent).not.toContain("Hermosillo");
  });
});

// Empty-state slot (issue #178): App passes a rich empty state that must show
// only before the tab has a result, and revert to the plain message when absent.
describe("ResultGrid empty-state slot (issue #178)", () => {
  function mount(props: {
    result?: ResultSet | null;
    loading?: boolean;
    emptyState?: unknown;
  }) {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ResultGrid
            result={props.result ?? null}
            loading={props.loading ?? false}
            error={null}
            emptyState={props.emptyState as never}
          />
        ),
        host!,
      );
    });
  }

  it("renders the slot when idle (no result/loading/error)", () => {
    mount({ emptyState: <div class="my-empty">Acciones rápidas</div> });
    expect(host!.querySelector(".my-empty")).not.toBeNull();
    // The plain fallback message is not shown when a slot is provided.
    expect(host!.textContent).not.toContain("Ejecuta una consulta para ver resultados.");
  });

  it("falls back to the plain message when no slot is given", () => {
    mount({});
    expect(host!.textContent).toContain("Ejecuta una consulta para ver resultados.");
  });

  it("hides the slot once a result arrives", () => {
    mount({ result, emptyState: <div class="my-empty">Acciones rápidas</div> });
    expect(host!.querySelector(".my-empty")).toBeNull();
    expect(host!.textContent).toContain("alice"); // the grid is shown instead
  });

  it("hides the slot while loading", () => {
    mount({ loading: true, emptyState: <div class="my-empty">Acciones rápidas</div> });
    expect(host!.querySelector(".my-empty")).toBeNull();
    expect(host!.textContent).toContain("Ejecutando…");
  });
});

// Column sizing (grid visual pass): content-aware initial widths + a drag handle
// per header column, replacing the old fixed 180px columns.
describe("ResultGrid column sizing", () => {
  function mountReadonly(r: ResultSet) {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <ResultGrid result={r} loading={false} error={null} />, host!);
    });
  }

  const wide: ResultSet = {
    columns: [
      { name: "id", type: "int" },
      { name: "description", type: "text" },
    ],
    rows: [["1", "a very long description value that should widen the column"]],
    truncated: false,
    rowsAffected: 0,
  };

  it("renders one resize handle per column", () => {
    mountReadonly(wide);
    expect(host!.querySelectorAll(".col-resize").length).toBe(2);
  });

  it("sizes columns from content: a long column is wider than a short one", () => {
    mountReadonly(wide);
    const header = host!.querySelector<HTMLElement>(".grid-header")!;
    const cols = header.style.gridTemplateColumns.split(/\s+/).map((s) => parseInt(s, 10));
    expect(cols.length).toBe(2);
    expect(cols[1]).toBeGreaterThan(cols[0]); // description wider than id
  });

  it("widens a column when its handle is dragged to the right", () => {
    mountReadonly(wide);
    const before = parseInt(
      host!.querySelector<HTMLElement>(".grid-header")!.style.gridTemplateColumns.split(/\s+/)[0],
      10,
    );
    const handle = host!.querySelectorAll<HTMLElement>(".col-resize")[0];
    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 160, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    const after = parseInt(
      host!.querySelector<HTMLElement>(".grid-header")!.style.gridTemplateColumns.split(/\s+/)[0],
      10,
    );
    expect(after).toBe(before + 60);
  });
});

// Keyboard navigation, selection, double-click-to-edit and bit display.
describe("ResultGrid selection + keyboard + bit display", () => {
  const grid: ResultSet = {
    columns: [
      { name: "id", type: "int" },
      { name: "activo", type: "bool" },
    ],
    rows: [
      ["1", "true"],
      ["2", "\x00"],
      ["3", "1"],
    ],
    truncated: false,
    rowsAffected: 0,
  };

  function mountRO(opts: { onRequestEdit?: () => void } = {}) {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ResultGrid
            result={grid}
            loading={false}
            error={null}
            onRequestEdit={opts.onRequestEdit}
          />
        ),
        host!,
      );
    });
  }

  const cells = () => host!.querySelectorAll<HTMLElement>(".grid-rows .grid-cell");

  it("renders boolean/bit values as 0/1", () => {
    mountRO();
    const boolCol = [...cells()].filter((c) => c.classList.contains("cell-bool"));
    expect(boolCol.map((c) => c.textContent)).toEqual(["1", "0", "1"]);
  });

  it("selects a cell on click", () => {
    mountRO();
    const cell = host!.querySelector<HTMLElement>('[data-cell="1-1"]')!; // row 1, col 1
    cell.click();
    expect(cell.classList.contains("cell-selected")).toBe(true);
  });

  it("moves the selection with the arrow keys", () => {
    mountRO();
    host!.querySelector<HTMLElement>('[data-cell="0-0"]')!.click();
    const scroll = host!.querySelector<HTMLElement>(".grid-scroll")!;
    scroll.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    scroll.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(host!.querySelector('[data-cell="1-1"]')!.classList.contains("cell-selected")).toBe(true);
    // the origin cell is no longer selected
    expect(host!.querySelector('[data-cell="0-0"]')!.classList.contains("cell-selected")).toBe(false);
  });

  it("requests edit mode on double-click of a cell", () => {
    let asked = 0;
    mountRO({ onRequestEdit: () => (asked += 1) });
    const cell = host!.querySelector<HTMLElement>('[data-cell="0-1"]')!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(asked).toBe(1);
  });

  it("requests edit mode on Enter over the selected cell", () => {
    let asked = 0;
    mountRO({ onRequestEdit: () => (asked += 1) });
    host!.querySelector<HTMLElement>('[data-cell="2-0"]')!.click();
    const scroll = host!.querySelector<HTMLElement>(".grid-scroll")!;
    scroll.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(asked).toBe(1);
  });

  it("does not request edit when the table is not editable (no handler)", () => {
    mountRO(); // no onRequestEdit
    const cell = host!.querySelector<HTMLElement>('[data-cell="0-0"]')!;
    // Should not throw and should still select.
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(cell.classList.contains("cell-selected")).toBe(true);
  });

  it("clears the selection when the sort changes (view-position would drift)", () => {
    mountRO();
    host!.querySelector<HTMLElement>('[data-cell="0-0"]')!.click();
    expect(host!.querySelector(".cell-selected")).not.toBeNull();
    host!.querySelectorAll<HTMLDivElement>(".grid-head-sort")[0].click(); // sort by id
    expect(host!.querySelector(".cell-selected")).toBeNull();
  });
});

describe("ResultGrid loading + cancel", () => {
  it("shows a Cancelar button while loading and calls onCancel when clicked", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    let canceled = 0;
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ResultGrid
            result={null}
            loading={true}
            error={null}
            onCancel={() => canceled++}
          />
        ),
        host!,
      );
    });
    expect(host!.textContent).toContain("Ejecutando");
    const btn = host!.querySelector<HTMLButtonElement>("button.grid-cancel")!;
    expect(btn).not.toBeNull();
    btn.click();
    expect(canceled).toBe(1);
  });

  it("shows no cancel button when onCancel is absent", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <ResultGrid result={null} loading={true} error={null} />, host!);
    });
    expect(host!.querySelector("button.grid-cancel")).toBeNull();
  });
});
