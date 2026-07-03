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

describe("App shell", () => {
  it("mounts and shows the connections sidebar", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <App />, host!);
    });
    expect(host.textContent).toContain("Conexiones");
    // A fresh workspace has one query tab and the empty-grid prompt.
    expect(host.querySelector(".tabbar")).not.toBeNull();
    expect(host.textContent).toContain("Ejecuta una consulta");
  });
});
