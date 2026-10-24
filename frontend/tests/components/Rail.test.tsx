import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { Rail } from "../../src/components/Rail";
import type { SideState } from "../../src/utils/sidePanel";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(side: SideState, connected = true, settingsOn = false) {
  const h = { onPick: vi.fn(), onConnections: vi.fn(), onSettings: vi.fn() };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <Rail side={side} connected={connected} settingsOn={settingsOn} {...h} />, host!);
  });
  return h;
}

const button = (label: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>(".rail-btn")].find(
    (b) => b.textContent?.trim() === label,
  )!;

describe("Rail", () => {
  it("labels every panel and marks the one shown", () => {
    mount({ panel: "history", collapsed: false });
    const tabs = [...host!.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(["Objetos", "Historial", "Snippets", "Datos"]);
    expect(button("Historial").getAttribute("aria-selected")).toBe("true");
    expect(button("Objetos").getAttribute("aria-selected")).toBe("false");
  });

  // #806: with the Settings tab in front the column shows its categories.
  it("marks Settings, and no panel, while the Settings tab is in front", () => {
    mount({ panel: "explorer", collapsed: false }, true, true);
    expect(button("Ajustes").classList.contains("on")).toBe(true);
    expect(button("Ajustes").getAttribute("aria-current")).toBe("page");
    expect(button("Objetos").getAttribute("aria-selected")).toBe("false");
  });

  it("marks nothing while the column is folded", () => {
    mount({ panel: "explorer", collapsed: true });
    expect(host!.querySelector(".rail-btn.on")).toBeNull();
  });

  it("hands the picked panel up, and opens connections and settings", () => {
    const h = mount({ panel: "explorer", collapsed: false });
    button("Snippets").click();
    button("Conexiones").click();
    button("Ajustes").click();
    expect(h.onPick).toHaveBeenCalledWith("snippets");
    expect(h.onConnections).toHaveBeenCalled();
    expect(h.onSettings).toHaveBeenCalled();
  });

  it("keeps the data search off without a connection, saying why", () => {
    mount({ panel: "explorer", collapsed: false }, false);
    expect(button("Datos").disabled).toBe(true);
    expect(button("Datos").title).toMatch(/Conéctate/);
  });
});
