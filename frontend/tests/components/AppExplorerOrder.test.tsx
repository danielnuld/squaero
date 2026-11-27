import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// The explorer's open connections (issue #824): grouped under their saved
// connection group, the ungrouped first with no heading, and reorderable by
// dragging a section header or with Alt+↑/↓ — only inside its own group.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
let opened = 0;

const rs = (cols: string[], rows: string[][]) => ({
  columns: cols.map((name) => ({ name, type: "text" })),
  rows,
  rowsAffected: 0,
  truncated: false,
});

beforeEach(() => {
  opened = 0;
  localStorage.clear();
  const db = (id: string, name: string, group?: string) => ({
    id,
    name,
    driver: "sqlite",
    params: { path: ":memory:" },
    ...(group ? { group } : {}),
  });
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([db("k1", "alfa"), db("k2", "beta", "Prod"), db("k3", "gamma")]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string };
    const result =
      req.method === "conn.open"
        ? { connId: `c${++opened}` }
        : req.method === "schema.tree"
          ? rs(["name"], [["main"]])
          : rs([], []);
    return { jsonrpc: "2.0", id: req.id, result };
  };
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as Record<string, unknown>).quaeroRpc;
});

const settle = async () => {
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

async function openAll() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  for (const name of ["alfa", "beta", "gamma"]) {
    (host.querySelector(".connbar-add") as HTMLElement).click();
    const hit = [...host.querySelectorAll<HTMLElement>(".connsearch-hit")].find((h) =>
      h.textContent?.includes(name),
    )!;
    hit.click();
    await settle();
  }
}

/** The explorer from top to bottom: group headings as «#name», sections by name. */
const explorer = () =>
  [...host!.querySelectorAll<HTMLElement>(".sidebar-tree > li")].map((li) =>
    li.classList.contains("conn-group-head")
      ? `#${li.textContent}`
      : li.querySelector(".connbar-name")!.textContent!.trim(),
  );

const section = (name: string) =>
  [...host!.querySelectorAll<HTMLElement>(".conn-section")].find(
    (li) => li.querySelector(".connbar-name")!.textContent!.trim() === name,
  )!;

const drag = (el: Element, type: string) =>
  el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

describe("App — ordering the explorer's connections", () => {
  it("groups the open connections, the ungrouped first and without a heading", async () => {
    await openAll();
    expect(explorer()).toEqual(["alfa", "gamma", "#Prod", "beta"]);
  });

  it("moves a section dragged onto another of its group", async () => {
    await openAll();
    drag(section("gamma").querySelector(".objtree-header")!, "dragstart");
    drag(section("alfa"), "dragover");
    expect(section("alfa").classList.contains("drop-before")).toBe(true);
    drag(section("alfa"), "drop");
    await settle();
    expect(explorer()).toEqual(["gamma", "alfa", "#Prod", "beta"]);
    expect(section("alfa").classList.contains("drop-before")).toBe(false);
  });

  it("refuses a drop into another group", async () => {
    await openAll();
    drag(section("beta").querySelector(".objtree-header")!, "dragstart");
    drag(section("alfa"), "dragover");
    expect(section("alfa").classList.contains("drop-before")).toBe(false);
    drag(section("alfa"), "drop");
    await settle();
    expect(explorer()).toEqual(["alfa", "gamma", "#Prod", "beta"]);
  });

  it("moves the section with Alt+↑/↓, stopping at its group's edge", async () => {
    await openAll();
    const key = (name: string, k: string) =>
      section(name)
        .querySelector(".connbar-pick")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: k, altKey: true, bubbles: true }));
    key("alfa", "ArrowDown");
    await settle();
    expect(explorer()).toEqual(["gamma", "alfa", "#Prod", "beta"]);
    key("alfa", "ArrowDown"); // already last of the ungrouped: beta is another group
    await settle();
    expect(explorer()).toEqual(["gamma", "alfa", "#Prod", "beta"]);
  });
});
