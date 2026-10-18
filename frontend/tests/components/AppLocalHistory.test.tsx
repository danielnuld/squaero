import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { EditorView } from "@codemirror/view";
import { App } from "../../src/App";
import { dropdownLabels } from "./dropdownHarness";
import { parseLocalHistory } from "../../src/utils/localHistory";

// Issue #674: the local history of the editor tabs, end to end inside the app —
// a closed tab keeps its last text, the tab menu opens the panel, and a restore
// replaces the tab's text while keeping what it held.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "quaero.workspace",
    JSON.stringify({
      tabs: [
        { id: 1, kind: "query", title: "Ventas", sql: "SELECT 1" },
        { id: 2, kind: "query", title: "Pedidos", sql: "SELECT 2" },
      ],
      activeId: 1,
      seq: 2,
    }),
  );
  localStorage.setItem(
    "quaero.localHistory",
    JSON.stringify([
      { tabId: 1, title: "Ventas", versions: [{ ts: Date.now() - 60_000, reason: "auto", sql: "SELECT old" }] },
    ]),
  );
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  localStorage.clear();
});

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
};

const byText = (sel: string, text: string) =>
  [...host!.querySelectorAll(sel)].find((b) => b.textContent?.trim() === text) as HTMLElement;
const tabByName = (name: string) =>
  [...host!.querySelectorAll('[role="tab"]')].find(
    (t) => t.getAttribute("aria-label") === name,
  ) as HTMLElement;
const stored = () => parseLocalHistory(localStorage.getItem("quaero.localHistory"));

describe("App — local history of the editor tabs", () => {
  it("keeps a closed tab's text, lists it, and restores a version over an open tab", () => {
    mount();
    byText("button", "Retomar").click();

    (tabByName("Pedidos").querySelector(".tab-close") as HTMLElement).click();
    expect(stored().find((h) => h.tabId === 2)?.versions[0]).toMatchObject({
      reason: "close",
      sql: "SELECT 2",
    });

    tabByName("Ventas").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    byText(".context-menu button", "Historial local…").click();
    expect(host!.querySelector(".local-history")).not.toBeNull();
    expect(dropdownLabels(host!.querySelector(".local-history [role=combobox]")!)).toContain(
      "Pedidos (cerrada)",
    );

    byText(".local-history button", "Restaurar").click();
    expect(stored().find((h) => h.tabId === 1)!.versions.map((v) => `${v.reason}:${v.sql}`)).toEqual([
      "restore:SELECT old",
      "auto:SELECT 1",
      "auto:SELECT old",
    ]);

    tabByName("Ventas").click();
    expect(EditorView.findFromDOM(host!)!.state.doc.toString()).toBe("SELECT old");
  });
});
