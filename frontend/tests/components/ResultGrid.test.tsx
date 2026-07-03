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
    const del = host!.querySelector<HTMLButtonElement>("button.row-del")!;
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
