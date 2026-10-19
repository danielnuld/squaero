import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { DocTabs, type DocTabView } from "../../src/components/DocTabs";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const TABS: DocTabView[] = [
  { id: 1, title: "Consulta 1", icon: "query", dirty: true },
  { id: 2, title: "clientes", icon: "table", color: "#2f7dd6", conn: "Ventas", safe: "readOnly" },
  { id: 3, title: "Monitor", icon: "tools", tool: true, running: true },
];

function mount(over: Partial<Parameters<typeof DocTabs>[0]> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onKeyDown: vi.fn(),
    onContextMenu: vi.fn(),
    onNew: vi.fn(),
    onPalette: vi.fn(),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => <DocTabs tabs={TABS} activeId={2} paletteKeys="Ctrl+K" {...handlers} {...over} />,
      host!,
    );
  });
  return handlers;
}

const tabs = () => [...host!.querySelectorAll<HTMLElement>('[role="tab"]')];

describe("DocTabs", () => {
  it("draws one tab per document with its type icon and marks the active one", () => {
    mount();
    expect(tabs()).toHaveLength(3);
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs()[0].querySelector('[data-icon="query"]')).not.toBeNull();
    expect(tabs()[1].querySelector('[data-icon="table"]')).not.toBeNull();
    expect(tabs()[2].classList.contains("tab-tool")).toBe(true);
  });

  it("shows the connection suffix, its colour and the protection lock", () => {
    mount();
    const t = tabs()[1];
    expect(t.querySelector(".tab-conn")?.textContent).toBe("· Ventas");
    expect(t.style.getPropertyValue("--conn-accent")).toBe("#2f7dd6");
    expect(t.querySelector(".tab-lock")).not.toBeNull();
    expect(tabs()[0].querySelector(".tab-conn")).toBeNull();
  });

  it("says a tab has unsaved edits and shows a spinner while it runs", () => {
    mount();
    expect(tabs()[0].getAttribute("aria-label")).toContain("sin guardar");
    expect(tabs()[0].querySelector(".tab-dot")).not.toBeNull();
    expect(tabs()[2].querySelector(".tab-spinner")).not.toBeNull();
    expect(tabs()[2].querySelector(".tab-icon")).toBeNull();
  });

  it("selects on click and closes from the close button or a middle click", () => {
    const h = mount();
    tabs()[0].click();
    expect(h.onSelect).toHaveBeenCalledWith(1);
    (tabs()[2].querySelector(".tab-close") as HTMLButtonElement).click();
    expect(h.onClose).toHaveBeenCalledWith(3, expect.anything());
    // The close click must not also select the tab it closes.
    expect(h.onSelect).toHaveBeenCalledTimes(1);
    tabs()[1].dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true }));
    expect(h.onClose).toHaveBeenCalledWith(2, expect.anything());
  });

  it("opens a new query and the palette", () => {
    const h = mount();
    (host!.querySelector(".tab-new") as HTMLButtonElement).click();
    (host!.querySelector(".tab-launch") as HTMLButtonElement).click();
    expect(h.onNew).toHaveBeenCalled();
    expect(h.onPalette).toHaveBeenCalled();
    expect(host!.querySelector(".tab-launch")?.textContent).toContain("Ctrl+K");
  });

  it("has no overflow button while every tab fits", () => {
    mount();
    expect(host!.querySelector(".tab-overflow")).toBeNull();
  });
});
