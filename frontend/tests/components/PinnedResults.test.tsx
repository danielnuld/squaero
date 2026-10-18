import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { PinStrip, CompareBar, pinScope, type PinnedResult } from "../../src/components/PinnedResults";
import { compareResults } from "../../src/utils/resultCompare";
import type { ResultSet } from "../../src/utils/query";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(view: () => JSX.Element) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(view, host!);
  });
}
const rs = (rows: (string | null)[][], truncated = false): ResultSet => ({
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
  ],
  rows,
  truncated,
  rowsAffected: 0,
});
const pin = (over: Partial<PinnedResult> = {}): PinnedResult => ({
  id: 1,
  ranAt: new Date(2026, 0, 1, 9, 5, 3).getTime(),
  sql: "SELECT * FROM t",
  result: rs([["1", "a"], ["2", "b"]]),
  offset: 0,
  pk: [],
  ...over,
});

describe("pinScope", () => {
  it("says which rows the pin holds and that it is not re-run", () => {
    expect(pinScope(pin())).toContain("filas 1–2");
    expect(pinScope(pin())).toContain("no se vuelve a ejecutar");
    expect(pinScope(pin({ offset: 1000, result: rs([["1", "a"]], true) }))).toContain("filas 1001–1001");
    expect(pinScope(pin({ result: rs([["1", "a"]], true) }))).toContain("había más");
    expect(pinScope(pin({ result: rs([]) }))).toContain("sin filas");
  });
});

describe("PinStrip", () => {
  it("lists the live result and each pin, and selects or closes a pin", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    mount(() => <PinStrip pins={[pin()]} shown={1} onSelect={onSelect} onClose={onClose} />);
    const open = host!.querySelector<HTMLButtonElement>(".pin-tab-open")!;
    expect(open.textContent).toContain("09:05:03");
    expect(open.getAttribute("aria-selected")).toBe("true");
    open.click();
    expect(onSelect).toHaveBeenCalledWith(1);
    host!.querySelector<HTMLButtonElement>(".rtab")!.click();
    expect(onSelect).toHaveBeenCalledWith(null);
    host!.querySelector<HTMLButtonElement>(".pin-tab-close")!.click();
    expect(onClose).toHaveBeenCalledWith(1);
  });
});

describe("CompareBar", () => {
  it("shows the counts, what was loaded, and changes the key", () => {
    const left = rs([["1", "a"], ["2", "b"]], true);
    const right = rs([["1", "A"], ["3", "c"]]);
    const cmp = compareResults(left, right, { by: "key", columns: ["id"] });
    const onKey = vi.fn();
    mount(() => (
      <CompareBar cmp={cmp} baseLabel="A" otherLabel="B" keyColumns={["id"]} onKey={onKey} onClose={() => {}} />
    ));
    const text = host!.textContent!;
    expect(text).toContain("+1");
    expect(text).toContain("−1");
    expect(text).toContain("~1");
    expect(text).toContain("Clave: id");
    expect(text).toContain("2 filas cargadas (había más, no se comparan)");
    const boxes = host!.querySelectorAll<HTMLInputElement>(".compare-key-list input");
    boxes[1]!.click(); // add "name"
    expect(onKey).toHaveBeenLastCalledWith(["id", "name"]);
    boxes[0]!.click(); // drop "id"
    expect(onKey).toHaveBeenLastCalledWith([]);
  });

  it("says why a key comparison could not run", () => {
    const cmp = compareResults(rs([]), rs([]), { by: "key", columns: ["code"] });
    mount(() => (
      <CompareBar cmp={cmp} baseLabel="A" otherLabel="B" keyColumns={["code"]} onKey={() => {}} onClose={() => {}} />
    ));
    expect(host!.textContent).toContain("falta code");
  });
});
