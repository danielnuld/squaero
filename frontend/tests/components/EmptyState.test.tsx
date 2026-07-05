import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { EmptyState } from "../../src/components/EmptyState";
import type { TreeNode } from "../../src/utils/tree";
import type { HistoryEntry } from "../../src/utils/history";
import type { Snippet } from "../../src/utils/snippets";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const tbl = (label: string): TreeNode => ({ key: `db:x/tbl:${label}`, label, kind: "table" });
const hist = (sql: string): HistoryEntry => ({ sql, ts: 1, connId: "c1", connName: "Demo" });
const snip = (id: string, name: string, body: string): Snippet => ({ id, name, body });

function mount(over: Partial<Parameters<typeof EmptyState>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const props = {
    recentTables: [],
    history: [],
    snippets: [],
    isMac: false,
    onOpenTable: () => {},
    onRunHistory: () => {},
    onInsertSnippet: () => {},
    ...over,
  };
  createRoot((d) => {
    dispose = d;
    render(() => <EmptyState {...props} />, host!);
  });
}

describe("EmptyState", () => {
  it("shows the shortcuts card always, and the hint when there is no data", () => {
    mount();
    expect(host!.querySelector(".empty-shortcuts")).not.toBeNull();
    expect(host!.textContent).toContain("Ejecutar la consulta");
    expect(host!.querySelector(".empty-state-hint")).not.toBeNull();
    // No data cards.
    expect(host!.textContent).not.toContain("Tablas recientes");
    expect(host!.textContent).not.toContain("Consultas recientes");
    expect(host!.textContent).not.toContain("Snippets");
  });

  it("opens a recent table via its handler", () => {
    const onOpenTable = vi.fn();
    mount({ recentTables: [tbl("orders"), tbl("customers")], onOpenTable });
    const links = [...host!.querySelectorAll(".empty-card")]
      .find((c) => c.querySelector("h4")?.textContent === "Tablas recientes")!
      .querySelectorAll<HTMLButtonElement>(".empty-link");
    expect(links).toHaveLength(2);
    links[0].click();
    expect(onOpenTable).toHaveBeenCalledWith(expect.objectContaining({ label: "orders" }));
    // No hint when there is data.
    expect(host!.querySelector(".empty-state-hint")).toBeNull();
  });

  it("re-runs a history entry via its handler", () => {
    const onRunHistory = vi.fn();
    mount({ history: [hist("SELECT 1"), hist("SELECT 2")], onRunHistory });
    const btn = host!.querySelector(".empty-sql") as HTMLButtonElement;
    expect(btn.textContent).toBe("SELECT 1");
    btn.click();
    expect(onRunHistory).toHaveBeenCalledWith("SELECT 1");
  });

  it("inserts a snippet body (not its name) via its handler", () => {
    const onInsertSnippet = vi.fn();
    mount({ snippets: [snip("s1", "count", "SELECT count(*) FROM t")], onInsertSnippet });
    const card = [...host!.querySelectorAll(".empty-card")].find(
      (c) => c.querySelector("h4")?.textContent === "Snippets",
    )!;
    const btn = card.querySelector(".empty-link") as HTMLButtonElement;
    expect(btn.textContent).toBe("count");
    btn.click();
    expect(onInsertSnippet).toHaveBeenCalledWith("SELECT count(*) FROM t");
  });

  it("caps each list at five items", () => {
    const many = Array.from({ length: 9 }, (_, i) => hist(`SELECT ${i}`));
    mount({ history: many });
    expect(host!.querySelectorAll(".empty-sql")).toHaveLength(5);
  });
});
