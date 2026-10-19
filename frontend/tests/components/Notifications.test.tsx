import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { Notifications } from "../../src/components/Notifications";
import type { Note } from "../../src/utils/notifications";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const notes: Note[] = [
  { id: 2, at: NOW - 60_000, level: "error", text: "No se pudo conectar a «Producción»" },
  { id: 1, at: NOW - 3_600_000, level: "ok", text: "Exportación terminada" },
];

function mount(list: Note[] = notes) {
  const h = { onClear: vi.fn(), onClose: vi.fn() };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <Notifications notes={list} now={() => NOW} {...h} />, host!);
  });
  return h;
}

const buttonNamed = (text: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;

describe("Notifications", () => {
  it("lists the notes newest first with level and time", () => {
    mount();
    const items = [...host!.querySelectorAll(".notes-item")];
    expect(items.map((i) => i.querySelector(".notes-text")?.textContent)).toEqual([
      "No se pudo conectar a «Producción»",
      "Exportación terminada",
    ]);
    expect(items[0].querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Error");
    expect(items[0].querySelector("time")?.textContent).toMatch(/minuto/);
  });

  it("asks before emptying the history", () => {
    const h = mount();
    buttonNamed("Vaciar historial…").click();
    expect(h.onClear).not.toHaveBeenCalled();
    expect(host!.textContent).toContain("Se eliminan las 2 notificaciones");
    buttonNamed("Vaciar").click();
    expect(h.onClear).toHaveBeenCalledOnce();
  });

  it("can cancel the confirmation without closing the panel", () => {
    const h = mount();
    buttonNamed("Vaciar historial…").click();
    buttonNamed("Cancelar").click();
    expect(h.onClear).not.toHaveBeenCalled();
    expect(h.onClose).not.toHaveBeenCalled();
    expect(host!.querySelector(".dlg")).toBeNull();
  });

  it("shows an empty state and nothing to empty", () => {
    mount([]);
    expect(host!.textContent).toContain("Sin notificaciones");
    expect(buttonNamed("Vaciar historial…").disabled).toBe(true);
  });

  it("closes on Escape and on a click outside", () => {
    const h = mount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(h.onClose).toHaveBeenCalledTimes(2);
    host!.querySelector(".notes-list")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(h.onClose).toHaveBeenCalledTimes(2);
  });
});
