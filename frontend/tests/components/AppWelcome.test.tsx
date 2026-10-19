import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Issue #694: with no tab open the workspace shows the welcome (recent
// connections, ways to start) and, once connected, the connection's home.

const saved = [
  { id: "k1", name: "local", driver: "sqlite", params: { path: ":memory:" } },
  { id: "k2", name: "notas", driver: "sqlite", params: { path: "/notas.db" } },
];

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("quaero.connections", JSON.stringify(saved));
  // notas was opened before: it leads the recents.
  localStorage.setItem("quaero.connections.used", JSON.stringify({ k2: Date.now() - 60_000 }));
  let opened = 0;
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string };
    const empty = { columns: [{ name: "name", type: "text" }], rows: [], rowsAffected: 0, truncated: false };
    const result = req.method === "conn.open" ? { connId: `c${++opened}` } : req.method === "schema.tree" ? empty : {};
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

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
};

describe("App — welcome and connected home (issue #694)", () => {
  it("starts on the welcome with no tab, connects from it and lands on the home", async () => {
    mount();
    await settle();
    // The app opens on the welcome: no tab to close first.
    expect(host!.querySelectorAll(".tab").length).toBe(0);
    const names = [...host!.querySelectorAll(".welcome-conn-name")].map((n) => n.textContent);
    expect(names).toEqual(["notas", "local"]);

    (host!.querySelectorAll(".welcome-conn")[1] as HTMLElement).click();
    await settle();
    expect(host!.querySelector(".welcome-home h1")?.textContent).toBe("local está lista");
    // The open was recorded: local now leads.
    expect(Object.keys(JSON.parse(localStorage.getItem("quaero.connections.used")!))).toContain("k1");

    const newQuery = [...host!.querySelectorAll<HTMLButtonElement>(".welcome-home button")].find((b) =>
      b.textContent?.startsWith("Nueva consulta"),
    )!;
    newQuery.click();
    await settle();
    expect(host!.querySelector(".welcome")).toBeNull();
    expect(host!.querySelector(".cm-editor")).not.toBeNull();
  });
});
