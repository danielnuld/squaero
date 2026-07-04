import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Smoke test: the workspace shell mounts and renders without throwing after the
// M7 edit wiring was added (a bad memo or store access would surface here).

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  return host;
};

describe("App shell", () => {
  it("mounts and shows the connections sidebar", () => {
    mount();
    expect(host!.textContent).toContain("Conexiones");
    // A fresh workspace has one query tab and the empty-grid prompt.
    expect(host!.querySelector(".tabbar")).not.toBeNull();
    expect(host!.textContent).toContain("Ejecuta una consulta");
  });
});

// UX polish (issue #42): theme toggle, shortcuts, help overlay.
describe("App — theme & shortcuts", () => {
  it("stamps a resolved theme on the document root at mount", () => {
    mount();
    const t = document.documentElement.getAttribute("data-theme");
    expect(t === "light" || t === "dark").toBe(true);
  });

  it("cycles the theme when the status-bar toggle is clicked", () => {
    mount();
    const btn = host!.querySelector(".statusbar .status-btn") as HTMLButtonElement;
    // Fresh preference is "system" (→ light under jsdom's no-matchMedia).
    btn.click(); // system → light
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    btn.click(); // light → dark
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("opens the shortcuts overlay with F1 and closes it with Escape", () => {
    mount();
    expect(host!.querySelector(".shortcuts")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1" }));
    expect(host!.querySelector(".shortcuts")).not.toBeNull();
    expect(host!.textContent).toContain("Atajos de teclado");
    // The shared Modal closes on Escape (issue #111).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host!.querySelector(".shortcuts")).toBeNull();
  });

  it("opens tools as in-window panels (labelled region, not a modal dialog)", () => {
    mount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1" }));
    // Tools no longer render as modal dialogs; they are in-window tool panels.
    expect(host!.querySelector('[role="dialog"]')).toBeNull();
    const region = host!.querySelector('.tool-pane[role="region"]') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.getAttribute("aria-label")).toContain("Atajos");
  });

  it("opens the shortcuts help as a tab and closing it returns to the query", () => {
    mount();
    expect(host!.querySelectorAll(".tab").length).toBe(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1" }));
    // A new (tool) tab appeared for the help panel.
    expect(host!.querySelectorAll(".tab").length).toBe(2);
    expect(host!.querySelector(".tab-tool")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host!.querySelectorAll(".tab").length).toBe(1);
  });

  it("opens a new tab with Ctrl+Alt+T", () => {
    mount();
    expect(host!.querySelectorAll(".tab").length).toBe(1);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "t", ctrlKey: true, altKey: true }),
    );
    expect(host!.querySelectorAll(".tab").length).toBe(2);
  });
});

// EXPLAIN plan (issue #131): the toolbar wires the button to the plan action.
describe("App — EXPLAIN", () => {
  it("has a Plan button that surfaces an honest error on an empty query", () => {
    mount();
    const btn = [...host!.querySelectorAll(".editor-hint .status-btn")].find(
      (b) => b.textContent === "Plan",
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click(); // fresh tab has empty SQL
    expect(host!.textContent).toContain("La consulta está vacía");
  });
});
