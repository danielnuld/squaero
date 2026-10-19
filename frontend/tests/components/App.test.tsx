import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";
import { openQueryTab } from "./appHelpers";

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
    // Explorer-first layout: the connection bar sits at the top of the sidebar.
    expect(host!.querySelector(".connbar")).not.toBeNull();
    // With nothing open the explorer says so and offers to connect (#525, #689).
    expect(host!.textContent).toContain("Sin conexión");
    expect(host!.textContent).toContain("No hay ninguna conexión abierta");
    // A fresh workspace opens on the welcome, with no tab (#694); a new query
    // tab shows the empty-grid prompt.
    expect(host!.querySelectorAll(".tab").length).toBe(0);
    expect(host!.querySelector(".welcome")).not.toBeNull();
    openQueryTab(host!);
    expect(host!.querySelector(".welcome")).toBeNull();
    expect(host!.textContent).toContain("Ejecuta una consulta");
  });
});

// The navigation band (issue #386): the ribbon of 12 destinations is gone, and
// what replaced it has to actually reach the same places.
describe("App — one navigation band", () => {
  it("has no ribbon and no tool strip; the search button opens the palette", () => {
    mount();
    expect(host!.querySelector(".apptoolbar")).toBeNull();
    // Tools live in the Herramientas menu and the palette (#688).
    expect(host!.querySelector(".toolstrip")).toBeNull();

    const launch = host!.querySelector(".tb-search") as HTMLButtonElement; // the title bar's (#688)
    expect(launch).not.toBeNull();
    launch.click();
    expect(host!.querySelector(".cmdk")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("spells the connection out on the tab only when several are open", () => {
    mount();
    expect(host!.querySelector(".tab-conn")).toBeNull();
  });
});

// The rail and the side column (issues #688, #689).
describe("App — rail", () => {
  const railButton = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>(".rail-btn")].find(
      (b) => b.textContent?.trim() === label,
    )!;

  it("switches the side column and folds it on the panel already shown", () => {
    localStorage.clear();
    mount();
    const aside = host!.querySelector<HTMLElement>("aside.sidebar")!;
    expect(aside.hidden).toBe(false);
    railButton("Historial").click();
    expect(aside.querySelector(".history")).not.toBeNull();
    expect(aside.querySelector<HTMLElement>(".side-explorer")!.hidden).toBe(true);
    railButton("Objetos").click();
    expect(aside.querySelector(".history")).toBeNull();
    railButton("Objetos").click();
    expect(aside.hidden).toBe(true);
    railButton("Objetos").click();
    expect(aside.hidden).toBe(false);
  });

  it("opens the settings as a tab from the rail", () => {
    mount();
    railButton("Ajustes").click();
    expect(host!.querySelector(".tab.active")?.textContent).toContain("Ajustes");
  });
});

// UX polish (issue #42): theme toggle, shortcuts, help overlay.
describe("App — theme & shortcuts", () => {
  it("stamps a resolved theme on the document root at mount", () => {
    mount();
    const t = document.documentElement.getAttribute("data-theme");
    expect(t === "light" || t === "dark").toBe(true);
  });

  // The status bar has no theme toggle any more (issue #693), and the theme has
  // no default key (R-17: Ctrl+Alt+L locks Linux screens). A key the user gives
  // it works.
  it("cycles the theme with a key the user gave it, and the status bar has no toggle", () => {
    localStorage.clear();
    localStorage.setItem("quaero.shortcuts", '{"toggle-theme":"Alt+Shift+T"}');
    localStorage.setItem("quaero.shortcuts.version", "2");
    mount();
    expect(host!.querySelector(".statusbar .status-btn")).toBeNull();
    const before = document.documentElement.getAttribute("data-theme");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "l", ctrlKey: true, altKey: true }));
    expect(document.documentElement.getAttribute("data-theme")).toBe(before);
    const press = () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "T", altKey: true, shiftKey: true }));
    // Fresh preference is "system" (→ light under jsdom's no-matchMedia).
    press(); // system → light
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    press(); // light → dark
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
    openQueryTab(host!);
    expect(host!.querySelectorAll(".tab").length).toBe(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1" }));
    // A new (tool) tab appeared for the help panel.
    expect(host!.querySelectorAll(".tab").length).toBe(2);
    expect(host!.querySelector(".tab-tool")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host!.querySelectorAll(".tab").length).toBe(1);
  });

  // R-17: Ctrl+Alt+T is AltGr+T on many layouts, which types a character.
  it("leaves Ctrl+Alt+T alone", () => {
    mount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true, altKey: true }));
    expect(host!.querySelectorAll(".tab").length).toBe(0);
  });

  it("closes every tab with Ctrl+Mayús+W", () => {
    mount();
    openQueryTab(host!);
    openQueryTab(host!);
    expect(host!.querySelectorAll(".tab").length).toBe(2);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "W", ctrlKey: true, shiftKey: true }));
    expect(host!.querySelectorAll(".tab").length).toBe(0);
  });

  it("hides and shows the side panel with Ctrl+B", () => {
    localStorage.clear();
    mount();
    const aside = host!.querySelector<HTMLElement>("aside.sidebar")!;
    expect(aside.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true }));
    expect(aside.hidden).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true }));
    expect(aside.hidden).toBe(false);
  });

  it("leaves Ctrl+B to whoever already handled it (the grid's related row)", () => {
    localStorage.clear();
    mount();
    const aside = host!.querySelector<HTMLElement>("aside.sidebar")!;
    const e = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, cancelable: true });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(aside.hidden).toBe(false);
  });

  it("opens the history in the side column with Ctrl+Mayús+H, and the settings with Ctrl+,", () => {
    localStorage.clear();
    mount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "H", ctrlKey: true, shiftKey: true }));
    expect(host!.querySelector("aside.sidebar .history")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true }));
    expect(host!.querySelector(".tab.active")?.textContent).toContain("Ajustes");
  });

  it("opens a tab with Ctrl+T and closes it with Ctrl+W, as in a browser (#591)", () => {
    mount();
    const t = new KeyboardEvent("keydown", { key: "t", ctrlKey: true, cancelable: true });
    document.dispatchEvent(t);
    expect(t.defaultPrevented).toBe(true); // the host never sees it
    expect(host!.querySelectorAll(".tab").length).toBe(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true }));
    // Closing the last tab is fine: back to the welcome (#694).
    expect(host!.querySelectorAll(".tab").length).toBe(0);
    expect(host!.querySelector(".welcome")).not.toBeNull();
  });
});

/** An entry of the editor toolbar's «Más» menu (issue #691), by its label. */
const moreItem = (label: string) => {
  ([...host!.querySelectorAll(".editor-toolbar button")] as HTMLElement[])
    .find((b) => b.getAttribute("aria-label")?.startsWith("Más:"))!
    .click();
  return ([...document.querySelectorAll(".context-menu-item")] as HTMLElement[]).find(
    (b) => b.textContent!.replace(b.querySelector(".context-menu-hint")?.textContent ?? "", "").trim() === label,
  ) as HTMLElement;
};

// EXPLAIN plan (issue #131): «Más» in the run toolbar wires it to the plan action.
describe("App — EXPLAIN", () => {
  it("has a Plan entry that surfaces an honest error on an empty query", () => {
    mount();
    openQueryTab(host!);
    const btn = moreItem("Plan");
    expect(btn).toBeTruthy();
    btn.click(); // fresh tab has empty SQL
    expect(host!.textContent).toContain("La consulta está vacía");
  });
});
