import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Issue #465: the saved session is OFFERED at startup instead of just appearing.
// Coming back is right when you were interrupted and wrong when you have moved
// on — yesterday's finished task used to reopen every morning.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

const WORKSPACE = JSON.stringify({
  tabs: [
    { id: 1, kind: "query", title: "Ventas", sql: "SELECT 1" },
    { id: 2, kind: "query", title: "Pedidos", sql: "SELECT 2" },
  ],
  activeId: 2,
  seq: 2,
});

beforeEach(() => localStorage.clear());

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
  return host;
};

const button = (label: string) =>
  [...host!.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined;

const tabTitles = () =>
  [...host!.querySelectorAll(".tabbar .tab-title")].map((e) => e.textContent);

describe("App — the previous session is offered", () => {
  it("asks before restoring, and starting blank leaves one fresh tab", () => {
    localStorage.setItem("quaero.workspace", WORKSPACE);
    mount();
    expect(host!.querySelector(".restore-prompt")).not.toBeNull();
    expect(host!.textContent).toContain("Sesión anterior");

    button("Empezar en blanco")!.click();
    expect(host!.querySelector(".restore-prompt")).toBeNull();
    expect(tabTitles().join(" ")).not.toContain("Ventas");
  });

  it("puts the saved tabs back when the answer is Retomar", () => {
    localStorage.setItem("quaero.workspace", WORKSPACE);
    mount();
    button("Retomar")!.click();
    expect(host!.querySelector(".restore-prompt")).toBeNull();
    expect(tabTitles()).toEqual(["Ventas", "Pedidos"]);
  });

  it("does not ask for the one empty tab the app would open anyway", () => {
    localStorage.setItem(
      "quaero.workspace",
      JSON.stringify({ tabs: [{ id: 1, kind: "query", title: "Consulta 1", sql: "" }], activeId: 1, seq: 1 }),
    );
    mount();
    expect(host!.querySelector(".restore-prompt")).toBeNull();
  });

  it("does not ask when there is no saved session at all", () => {
    mount();
    expect(host!.querySelector(".restore-prompt")).toBeNull();
  });
});
