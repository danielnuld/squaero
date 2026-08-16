import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Panel } from "../../src/components/Panel";

// The shell every tool panel sits in (#372). It owns the one bar they used to
// build for themselves, so what it does with actions, status and refresh is the
// contract twelve panels now depend on.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(el: () => unknown) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(el as never, host!);
  });
}

const bar = () => host!.querySelector(".panel-bar");
const refresh = () => host!.querySelector<HTMLButtonElement>(".panel-icon-btn");

describe("Panel", () => {
  it("shows no bar at all when the tool asked for nothing", () => {
    mount(() => <Panel title="Herramienta">cuerpo</Panel>);
    expect(bar()).toBeNull();
    expect(host!.textContent).toBe("cuerpo");
  });

  it("names the region with the title instead of repeating it as a heading", () => {
    mount(() => <Panel title="Monitor de servidor">cuerpo</Panel>);
    const region = host!.querySelector("[role='region']")!;
    expect(region.getAttribute("aria-label")).toBe("Monitor de servidor");
    // The tab carries the visible title; the panel must not print it again.
    expect(host!.querySelector("h2")).toBeNull();
  });

  it("puts the tool's actions before its status", () => {
    mount(() => (
      <Panel
        title="X"
        actions={<button class="edit-btn">Reiniciar</button>}
        status={<span>4 sesiones</span>}
      >
        cuerpo
      </Panel>
    ));
    const text = bar()!.textContent!;
    expect(text.indexOf("Reiniciar")).toBeLessThan(text.indexOf("4 sesiones"));
  });

  it("offers refresh only when the tool can refresh, and names it for a screen reader", () => {
    mount(() => <Panel title="X">cuerpo</Panel>);
    expect(refresh()).toBeNull();

    dispose?.();
    host?.remove();
    const onRefresh = vi.fn();
    mount(() => (
      <Panel title="X" onRefresh={onRefresh}>
        cuerpo
      </Panel>
    ));
    const btn = refresh()!;
    // Icon only: no text, so the name has to come from the label.
    expect(btn.textContent).toBe("");
    expect(btn.getAttribute("aria-label")).toBe("Refrescar");
    expect(btn.querySelectorAll("svg").length).toBe(1);
    btn.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables refresh while it is running and says so", () => {
    const [busy, setBusy] = createSignal(false);
    mount(() => (
      <Panel title="X" onRefresh={() => {}} refreshing={busy()}>
        cuerpo
      </Panel>
    ));
    expect(refresh()!.disabled).toBe(false);
    setBusy(true);
    expect(refresh()!.disabled).toBe(true);
    expect(refresh()!.getAttribute("aria-label")).toBe("Actualizando…");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    mount(() => (
      <Panel title="X" onClose={onClose}>
        cuerpo
      </Panel>
    ));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
