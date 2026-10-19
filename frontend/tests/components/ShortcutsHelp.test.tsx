import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import { ShortcutsHelp } from "../../src/components/ShortcutsHelp";
import { SHORTCUTS, type ActionId } from "../../src/utils/shortcuts";

// M14 ShortcutsHelp: grouped, searchable, a group filter, the user's changes
// marked, «Personalizar» to edit them, and «Sin atajo» for an unbound action.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(over: { customized?: Set<ActionId>; onCustomize?: () => void; shortcuts?: typeof SHORTCUTS } = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <ShortcutsHelp
        isMac={false}
        shortcuts={over.shortcuts}
        customized={over.customized}
        onCustomize={over.onCustomize}
        onClose={() => {}}
      />
    ),
    host!,
  );
}

const groups = () => [...host!.querySelectorAll(".shortcuts-group h3")].map((h) => h.textContent);

describe("ShortcutsHelp (M14)", () => {
  it("lists the shortcuts by group", () => {
    mount();
    expect(groups()).toEqual(["General", "Pestañas", "Editor SQL", "Transacción manual", "Rejilla"]);
  });

  it("searches by name or keys and filters by group", () => {
    mount();
    const input = host!.querySelector<HTMLInputElement>(".shortcuts-search")!;
    input.value = "ctrl+w";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(groups()).toEqual(["Pestañas"]);
    input.value = "";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const grid = [...host!.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === "Rejilla")!;
    grid.click();
    expect(grid.getAttribute("aria-checked")).toBe("true");
    expect(groups()).toEqual(["Rejilla"]);
    input.value = "zzzz";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(host!.textContent).toContain("Ningún atajo coincide con «zzzz».");
  });

  it("marks the customized ones, says «Sin atajo», and opens the editor", () => {
    const onCustomize = vi.fn();
    const shortcuts = SHORTCUTS.map((s) => (s.id === "close-tab" ? { ...s, keys: "" } : s));
    mount({ customized: new Set<ActionId>(["close-tab"]), onCustomize, shortcuts });
    const row = [...host!.querySelectorAll("tr")].find((r) => r.textContent?.startsWith("Cerrar la pestaña activa"))!;
    expect(row.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Personalizado");
    expect(row.textContent).toContain("Sin atajo");
    [...host!.querySelectorAll("button")].find((b) => b.textContent === "Personalizar")!.click();
    expect(onCustomize).toHaveBeenCalled();
  });
});
