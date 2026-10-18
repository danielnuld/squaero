import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { LocalHistoryPanel } from "../../src/components/LocalHistoryPanel";
import type { TabHistory } from "../../src/utils/localHistory";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const docs: TabHistory[] = [
  {
    tabId: 1,
    title: "Consulta 1",
    versions: [
      { ts: 2000, reason: "run", sql: "SELECT a\nFROM t" },
      { ts: 1000, reason: "auto", sql: "SELECT b\nFROM t" },
    ],
  },
  { tabId: 7, title: "Vieja", versions: [{ ts: 500, reason: "close", sql: "SELECT 7" }] },
];

function mount(props: Partial<Parameters<typeof LocalHistoryPanel>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const full = {
    docs,
    tabId: 1,
    // Tab 1 is open with this text; tab 7 is closed.
    currentSql: (id: number) => (id === 1 ? "SELECT a\nFROM t" : undefined),
    onRestore: () => {},
    onOpenCopy: () => {},
    onClose: () => {},
    ...props,
  };
  createRoot((d) => {
    dispose = d;
    render(() => <LocalHistoryPanel {...full} />, host!);
  });
}

const buttonByText = (text: string) =>
  [...host!.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

describe("LocalHistoryPanel", () => {
  it("lists the tab's versions with their reason", () => {
    mount();
    const items = host!.querySelectorAll(".lhist-versions .history-item");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("Al ejecutar");
    expect(items[1].textContent).toContain("Automática");
  });

  it("shows the diff of the picked version against the current text, and restores it", () => {
    const onRestore = vi.fn();
    mount({ onRestore });
    // The newest version equals the current text: nothing to restore.
    expect(host!.textContent).toContain("Igual que el texto actual");
    expect(buttonByText("Restaurar").disabled).toBe(true);

    host!.querySelectorAll<HTMLButtonElement>(".lhist-versions .history-run")[1].click();
    const lines = [...host!.querySelectorAll(".lhist-line")].map((l) => l.className);
    expect(lines.some((c) => c.includes("lhist-del"))).toBe(true);
    expect(lines.some((c) => c.includes("lhist-add"))).toBe(true);
    expect(host!.querySelector(".lhist-del")!.textContent).toContain("SELECT b");

    buttonByText("Restaurar").click();
    expect(onRestore).toHaveBeenCalledWith(1, "SELECT b\nFROM t");
  });

  it("a closed tab cannot be restored in place, but opens in a new tab", () => {
    const onOpenCopy = vi.fn();
    mount({ tabId: 7, onOpenCopy });
    expect(host!.querySelector("select")!.textContent).toContain("Vieja (cerrada)");
    expect(buttonByText("Restaurar").disabled).toBe(true);
    buttonByText("Abrir en una pestaña nueva").click();
    expect(onOpenCopy).toHaveBeenCalledWith("Vieja", "SELECT 7");
  });

  it("says so when the tab has no versions yet, or nothing has any", () => {
    mount({ tabId: 99 });
    expect(host!.textContent).toContain("todavía no tiene versiones");
    dispose?.();
    host?.remove();
    mount({ docs: [] });
    expect(host!.textContent).toContain("Todavía no hay versiones");
  });
});
