import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { HistoryPanel } from "../../src/components/HistoryPanel";
import type { HistoryEntry } from "../../src/utils/history";

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

  it("runs the picked query and closes", () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    mount({ onRun, onClose });
    (host!.querySelector(".history-run") as HTMLButtonElement).click();
    expect(onRun).toHaveBeenCalledWith("SELECT * FROM orders");
    expect(onClose).toHaveBeenCalled();
  });

  it("clears the history when the danger button is clicked with entries", () => {
    const onClear = vi.fn();
    mount({ onClear });
    const clear = host!.querySelector(".danger") as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(onClear).toHaveBeenCalled();
  });

  it("shows an empty state when there is no history", () => {
    mount({ entries: [] });
    expect(host!.querySelector(".history-empty")!.textContent).toContain("Aún no has ejecutado");
    expect((host!.querySelector(".danger") as HTMLButtonElement).disabled).toBe(true);
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
