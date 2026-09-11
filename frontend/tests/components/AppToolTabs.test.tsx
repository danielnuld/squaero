import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Integration for issues #492/#493: a tool tab belongs to the connection it was
// opened against. With two connections open, asking for the users of the second
// one used to jump back to the first one's panel — the tabs were deduped by tool
// + key, and the key ("users") says nothing about which server it reads.
//
// The core is faked at the bridge (globalThis.quaeroRpc), the seam the webview
// binds, so App runs unmodified.

const rs = (columns: [string, string][], rows: (string | null)[][]) => ({
  columns: columns.map(([name, type]) => ({ name, type })),
  rows,
  rowsAffected: rows.length,
  truncated: false,
});

let opened = 0;

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  opened = 0;
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([
      { id: "k1", name: "local", driver: "mysql", params: { host: "127.0.0.1" } },
      { id: "k2", name: "prod", driver: "mysql", params: { host: "10.0.0.9" } },
    ]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string };
    const result =
      req.method === "conn.open"
        ? { connId: `c${++opened}` }
        : req.method === "schema.tree"
          ? rs([["name", "text"]], [["testdb"]])
          : {};
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

/** Let every pending microtask/promise chain settle (the App's IPC is async). */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function mountApp() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
}

/** Open the connections popover and connect (or focus) the nth saved one. */
const connect = async (n: number) => {
  (host!.querySelector(".connbar-active") as HTMLElement).click();
  const entries = host!.querySelectorAll<HTMLElement>(".conn-list .conn-open");
  entries[n].click();
  await settle();
};

/** Click a tool in the strip under the tabs, by its accessible title. */
const openTool = (title: string) => {
  const btn = [...host!.querySelectorAll<HTMLElement>(".toolstrip-btn")].find((b) =>
    (b.getAttribute("title") ?? "").startsWith(title),
  );
  btn!.click();
};

const toolTabs = () =>
  [...host!.querySelectorAll<HTMLElement>(".tab-tool .tab-title")].map((el) => el.textContent);

describe("App — a tool tab per connection", () => {
  it("opens the users panel of each connection instead of reusing the first", async () => {
    mountApp();
    await connect(0);
    openTool("Usuarios");
    expect(toolTabs()).toEqual(["Usuarios y permisos"]); // alone: no name to add

    await connect(1); // connecting the second focuses it
    openTool("Usuarios");
    expect(toolTabs()).toEqual(["Usuarios y permisos", "Usuarios y permisos · prod"]);

    // Asking the same connection again goes back to its tab, not a third one.
    openTool("Usuarios");
    expect(toolTabs()).toHaveLength(2);
  });

  // Issue #498: the tab was reused but its snapshot was not, so editing a second
  // connection opened the first one's draft under the second one's name.
  it("shows the second connection when the form is already open for the first", async () => {
    mountApp();
    (host!.querySelector(".connbar-active") as HTMLElement).click();
    const edit = () => host!.querySelectorAll<HTMLElement>(".conn-list button[title='Editar']");
    edit()[0].click();
    await settle();
    const nameInput = () => host!.querySelector<HTMLInputElement>(".field input[type='text']")!;
    expect(nameInput().value).toBe("local");

    (host!.querySelector(".connbar-active") as HTMLElement).click();
    edit()[1].click();
    await settle();
    expect(host!.querySelectorAll(".tab-tool").length).toBe(1);
    expect(nameInput().value).toBe("prod");
  });

  it("keeps one tab for a tool that belongs to no connection", async () => {
    mountApp();
    await connect(0);
    await connect(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1" })); // shortcuts help
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1" }));
    expect(host!.querySelectorAll(".tab-tool").length).toBe(1);
  });
});
