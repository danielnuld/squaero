import { describe, it, expect, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RowDetail } from "../../src/components/RowDetail";
import type { ResultColumn } from "../../src/utils/query";
import type { FkLookup } from "../../src/utils/fkLookup";

// Drives the real RowDetail in jsdom: read-only display, edit-mode textareas that
// write back through onEditCell, navigation bounds, and the delete toggle.

const columns: ResultColumn[] = [
  { name: "id", type: "int" },
  { name: "name", type: "text" },
  { name: "notes", type: "text" },
];
const rows: (string | null)[][] = [
  ["1", "alice", null],
  ["2", "bob", "hello"],
];

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

interface Opts {
  rowIndex?: number;
  editing?: boolean;
  editable?: boolean;
  deleted?: boolean;
  edits?: Record<string, string | null>;
  fk?: Record<string, FkLookup>;
  onEditCell?: (c: string, v: string) => void;
  onToggleDelete?: () => void;
  onBeginEdit?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

function mount(opts: Opts = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const [idx] = createSignal(opts.rowIndex ?? 0);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <RowDetail
          columns={columns}
          row={rows[idx()]}
          rowIndex={idx()}
          total={rows.length}
          editing={opts.editing ?? false}
          editable={opts.editable ?? true}
          deleted={opts.deleted ?? false}
          edits={opts.edits}
          fk={opts.fk}
          onEditCell={opts.onEditCell ?? (() => {})}
          onToggleDelete={opts.onToggleDelete ?? (() => {})}
          onBeginEdit={opts.onBeginEdit ?? (() => {})}
          onPrev={opts.onPrev ?? (() => {})}
          onNext={opts.onNext ?? (() => {})}
          onClose={() => {}}
        />
      ),
      host!,
    );
  });
  return host!;
}

describe("RowDetail", () => {
  it("shows every column as a labelled field, NULL rendered explicitly", () => {
    const el = mount({ rowIndex: 0 });
    const names = [...el.querySelectorAll(".rd-name")].map((n) => n.textContent);
    expect(names).toEqual(["id", "name", "notes"]);
    const nullCell = el.querySelector(".rd-value.rd-null");
    expect(nullCell?.textContent).toBe("NULL");
  });

  it("is read-only when not editing (no inputs) and offers Editar when editable", () => {
    const el = mount({ editing: false, editable: true });
    expect(el.querySelectorAll(".rd-input").length).toBe(0);
    const btn = [...el.querySelectorAll("button")].find((b) => b.textContent === "Editar");
    expect(btn).toBeTruthy();
  });

  it("edits a field through onEditCell when editing", () => {
    let captured: [string, string] | null = null;
    const el = mount({ editing: true, onEditCell: (c, v) => (captured = [c, v]) });
    const inputs = el.querySelectorAll<HTMLTextAreaElement>(".rd-input");
    expect(inputs.length).toBe(3);
    inputs[1].value = "ALICE";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    expect(captured).toEqual(["name", "ALICE"]);
  });

  it("edits a foreign-key field by picking a row of the referenced table", () => {
    let captured: [string, string] | null = null;
    const el = mount({
      editing: true,
      onEditCell: (c, v) => (captured = [c, v]),
      fk: {
        id: {
          toTable: "clientes",
          toColumn: "num",
          columns: [
            { name: "num", type: "int" },
            { name: "nombre", type: "text" },
          ],
          rows: [
            ["1", "Ferretería López"],
            ["7", "Aceros SA"],
          ],
        },
      },
    });
    // The FK field says where it points and offers a picker; the others stay textareas.
    expect(el.querySelector(".rd-fk-ref")?.textContent).toBe("→ clientes.num");
    expect(el.querySelectorAll("textarea.rd-input").length).toBe(2);
    // Opening it lists the referenced rows even though the field already holds "1".
    el.querySelector<HTMLButtonElement>(".fk-toggle")!.click();
    const picks = document.querySelectorAll<HTMLButtonElement>(".fk-browser .fk-pick");
    expect(picks.length).toBe(2);
    picks[1].click();
    expect(captured).toEqual(["id", "7"]);
  });

  it("flags an edited field and shows its pending value", () => {
    const el = mount({ editing: true, edits: { name: "ALICE" } });
    const edited = el.querySelector(".rd-field.rd-edited");
    expect(edited?.querySelector(".rd-name")?.textContent).toBe("name");
    const input = edited?.querySelector<HTMLTextAreaElement>(".rd-input");
    expect(input?.value).toBe("ALICE");
  });

  it("disables prev at the first row and enables next", () => {
    const el = mount({ rowIndex: 0 });
    const prev = el.querySelector<HTMLButtonElement>(".rd-nav-btn:first-of-type");
    const next = el.querySelectorAll<HTMLButtonElement>(".rd-nav-btn")[1];
    expect(prev?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);
    expect(el.querySelector(".rd-pos")?.textContent).toContain("Fila 1 de 2");
  });

  it("toggles delete while editing", () => {
    let toggled = 0;
    const el = mount({ editing: true, onToggleDelete: () => (toggled += 1) });
    const btn = [...el.querySelectorAll("button")].find((b) => b.textContent === "Borrar fila");
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggled).toBe(1);
  });

  it("hides inputs and shows the banner when the row is marked deleted", () => {
    const el = mount({ editing: true, deleted: true });
    expect(el.querySelectorAll(".rd-input").length).toBe(0);
    expect(el.querySelector(".rd-deleted-banner")).toBeTruthy();
    const undo = [...el.querySelectorAll("button")].find(
      (b) => b.textContent === "Deshacer borrado",
    );
    expect(undo).toBeTruthy();
  });

  // Prop changes on a MOUNTED instance — navigation and entering edit mode both
  // arrive as prop updates, not a remount. Guards the reactivity CI is blind to.
  it("reacts to prop changes without remounting (navigate + toggle editing)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [idx, setIdx] = createSignal(0);
    const [editing, setEditing] = createSignal(false);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <RowDetail
            columns={columns}
            row={rows[idx()]}
            rowIndex={idx()}
            total={rows.length}
            editing={editing()}
            editable={true}
            deleted={false}
            onEditCell={() => {}}
            onToggleDelete={() => {}}
            onBeginEdit={() => {}}
            onPrev={() => setIdx((i) => Math.max(0, i - 1))}
            onNext={() => setIdx((i) => Math.min(rows.length - 1, i + 1))}
            onClose={() => {}}
          />
        ),
        host!,
      );
    });
    // Row 0: a NULL notes cell, prev disabled, no inputs.
    expect(host!.querySelector(".rd-pos")?.textContent).toContain("Fila 1 de 2");
    expect(host!.querySelector(".rd-value.rd-null")).toBeTruthy();
    expect(host!.querySelector<HTMLButtonElement>(".rd-nav-btn")?.disabled).toBe(true);

    // Navigate to row 1: notes now has text, prev enabled.
    setIdx(1);
    expect(host!.querySelector(".rd-pos")?.textContent).toContain("Fila 2 de 2");
    expect(host!.querySelector(".rd-value.rd-null")).toBeNull();
    expect(host!.querySelector<HTMLButtonElement>(".rd-nav-btn")?.disabled).toBe(false);

    // Enter edit mode: fields become textareas, no remount.
    setEditing(true);
    expect(host!.querySelectorAll(".rd-input").length).toBe(columns.length);
  });
});
