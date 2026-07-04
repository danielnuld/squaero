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
  { sql: "SELECT * FROM orders", ts: 1000, connId: "c1", connName: "Demo" },
  { sql: "UPDATE customers SET x=1", ts: 900, connId: "c1", connName: "Demo" },
];

function mount(props: Partial<Parameters<typeof HistoryPanel>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const full = {
    entries,
    limit: 200,
    onRun: () => {},
    onClear: () => {},
    onChangeLimit: () => {},
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

  it("clamps and reports a changed limit", () => {
    const onChangeLimit = vi.fn();
    mount({ onChangeLimit });
    const input = host!.querySelector(".history-limit input") as HTMLInputElement;
    input.value = "1"; // below MIN -> clamped to 10
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChangeLimit).toHaveBeenCalledWith(10);
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
});
