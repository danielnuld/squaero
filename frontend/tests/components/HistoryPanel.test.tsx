import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { HistoryPanel } from "../../src/components/HistoryPanel";
import type { HistoryEntry } from "../../src/utils/history";
import { pickOption } from "./dropdownHarness";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const entries: HistoryEntry[] = [
  { sql: "SELECT * FROM orders", ts: 1000, connId: "c1", connName: "Demo", durationMs: 1500 },
  { sql: "UPDATE customers SET x=1", ts: 900, connId: "c1", connName: "Demo", durationMs: 40 },
];

function mount(props: Partial<Parameters<typeof HistoryPanel>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const full = {
    entries,
    slowThresholdMs: 1000,
    onRun: () => {},
    onInsert: () => {},
    onOpen: () => {},
    onClear: () => {},
    onClose: () => {},
    ...props,
  };
  createRoot((d) => {
    dispose = d;
    render(() => <HistoryPanel {...full} />, host!);
  });
}

describe("HistoryPanel", () => {
  it("lists stored queries", () => {
    mount();
    const items = host!.querySelectorAll(".history-run");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("SELECT * FROM orders");
  });

  it("filters by the search text", () => {
    mount();
    const search = host!.querySelector(".history-search") as HTMLInputElement;
    search.value = "update";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    const items = host!.querySelectorAll(".history-run");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("UPDATE customers");
  });

  it("a click only selects: nothing runs, the actions appear", () => {
    const onRun = vi.fn();
    const onInsert = vi.fn();
    const onOpen = vi.fn();
    mount({ onRun, onInsert, onOpen });
    const rows = host!.querySelectorAll<HTMLButtonElement>(".history-run");
    rows[1].click(); // the UPDATE
    expect(onRun).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(rows[1].getAttribute("aria-expanded")).toBe("true");
    const labels = [...host!.querySelectorAll(".history-actions button")].map((b) => b.textContent);
    expect(labels).toEqual(["Insertar", "Abrir en pestaña nueva", "Ejecutar"]);
  });

  it("each action is explicit and closes the floating panel", () => {
    const onRun = vi.fn();
    const onInsert = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    mount({ onRun, onInsert, onOpen, onClose });
    const row = host!.querySelector<HTMLButtonElement>(".history-run")!;
    row.click();
    const [insert, open, run] = host!.querySelectorAll<HTMLButtonElement>(".history-actions button");
    insert.click();
    expect(onInsert).toHaveBeenCalledWith("SELECT * FROM orders");
    row.click();
    open.click();
    expect(onOpen).toHaveBeenCalledWith("SELECT * FROM orders");
    row.click();
    run.click();
    expect(onRun).toHaveBeenCalledWith("SELECT * FROM orders");
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("double click inserts in the active tab, never runs", () => {
    const onRun = vi.fn();
    const onInsert = vi.fn();
    mount({ onRun, onInsert });
    host!.querySelectorAll(".history-run")[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onInsert).toHaveBeenCalledWith("UPDATE customers SET x=1");
    expect(onRun).not.toHaveBeenCalled();
  });

  it("clears the history only after confirming, naming how many queries go", () => {
    const onClear = vi.fn();
    mount({ onClear });
    const clear = host!.querySelector(".danger-text") as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(onClear).not.toHaveBeenCalled();
    const confirm = host!.querySelector(".dlg-actions .btn-danger") as HTMLButtonElement;
    expect(confirm.textContent).toMatch(/^Eliminar \d+ consultas?$/);
    confirm.click();
    expect(onClear).toHaveBeenCalled();
  });

  it("shows an empty state when there is no history", () => {
    mount({ entries: [] });
    expect(host!.querySelector(".empty-note")!.textContent).toContain("Sin consultas aún");
    expect((host!.querySelector(".danger-text") as HTMLButtonElement).disabled).toBe(true);
    // No action unless the workspace offers one.
    expect(host!.querySelector(".empty-note button")).toBeNull();
  });

  // Issue #694: one primary action per empty state.
  it("offers a new query when empty, and clearing a search with no matches", () => {
    const onNewQuery = vi.fn();
    mount({ entries: [], onNewQuery });
    (host!.querySelector(".empty-note button") as HTMLButtonElement).click();
    expect(onNewQuery).toHaveBeenCalledOnce();
    dispose?.();
    host?.remove();
    mount();
    const box = host!.querySelector('input[type="search"]') as HTMLInputElement;
    box.value = "zzz-nothing";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    const clear = host!.querySelector(".empty-note button") as HTMLButtonElement;
    expect(clear.textContent).toBe("Quitar la búsqueda");
    clear.click();
    expect(host!.querySelector(".empty-note")).toBeNull();
    expect(box.value).toBe("");
  });

  it("shows per-entry duration and marks the slow one (#179)", () => {
    mount();
    const durations = [...host!.querySelectorAll(".history-duration")];
    expect(durations).toHaveLength(2);
    // The 1500ms run is over the 1000ms threshold -> marked slow.
    const slow = host!.querySelector(".history-duration.slow")!;
    expect(slow.textContent).toContain("1.5 s");
    expect(slow.textContent).toContain("lenta");
  });

  it('filters to slow runs with "Solo lentas" (#179)', () => {
    mount();
    expect(host!.querySelectorAll(".history-run")).toHaveLength(2);
    const toggle = host!.querySelector(".history-only-slow input") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    const rows = host!.querySelectorAll(".history-run");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("SELECT * FROM orders");
  });
});

// Issue #642: the panel filters by engine, starting on the focused one.
describe("HistoryPanel engine filter", () => {
  const mixed: HistoryEntry[] = [
    { sql: "SELECT 1", ts: 3, connId: "a", connName: "My", engine: "mysql" },
    { sql: "SELECT FIRST 1 *", ts: 2, connId: "b", connName: "Ifx", engine: "informix" },
    { sql: "SELECT old", ts: 1, connId: "a", connName: "My" },
  ];

  it("starts on the focused connection's engine", () => {
    mount({ entries: mixed, engine: "informix" });
    const items = host!.querySelectorAll(".history-run");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("SELECT FIRST 1 *");
  });

  it("shows every engine when switched to all", () => {
    mount({ entries: mixed, engine: "informix" });
    pickOption(host!.querySelector(".history-engine")!, "");
    expect(host!.querySelectorAll(".history-run")).toHaveLength(3);
  });

  it("shows everything when the focused engine has no history", () => {
    mount({ entries: mixed, engine: "postgres" });
    expect(host!.querySelectorAll(".history-run")).toHaveLength(3);
  });
});
