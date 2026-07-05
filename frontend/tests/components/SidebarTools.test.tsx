import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { SidebarTools } from "../../src/components/SidebarTools";
import { TOOL_CATALOG, type ToolMenuItem } from "../../src/utils/toolCatalog";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(over: {
  collapsed?: boolean;
  onToggle?: () => void;
  onOpen?: (t: ToolMenuItem) => void;
} = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const [collapsed, setCollapsed] = createSignal(over.collapsed ?? false);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <SidebarTools
          collapsed={collapsed()}
          onToggle={over.onToggle ?? (() => setCollapsed((c) => !c))}
          onOpen={over.onOpen ?? (() => {})}
        />
      ),
      host!,
    );
  });
  return { setCollapsed };
}

describe("SidebarTools", () => {
  it("lists every catalog tool with icon + label when expanded", () => {
    mount({ collapsed: false });
    const items = host!.querySelectorAll(".tool-item");
    expect(items).toHaveLength(TOOL_CATALOG.length);
    // Each item exposes an accessible label + tooltip.
    const first = items[0] as HTMLButtonElement;
    expect(first.getAttribute("aria-label")).toBe(TOOL_CATALOG[0].label);
    expect(first.title).toBe(TOOL_CATALOG[0].title);
    expect(host!.textContent).toContain(TOOL_CATALOG[0].icon);
  });

  it("hides the list when collapsed and reflects aria-expanded", () => {
    mount({ collapsed: true });
    expect(host!.querySelectorAll(".tool-item")).toHaveLength(0);
    const header = host!.querySelector(".sidebar-tools-header")!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles collapse via the header", () => {
    const onToggle = vi.fn();
    mount({ collapsed: false, onToggle });
    (host!.querySelector(".sidebar-tools-header") as HTMLButtonElement).click();
    expect(onToggle).toHaveBeenCalled();
  });

  it("opens a tool with its catalog descriptor", () => {
    const onOpen = vi.fn();
    mount({ onOpen });
    (host!.querySelectorAll<HTMLButtonElement>(".tool-item")[1]).click();
    expect(onOpen).toHaveBeenCalledWith(TOOL_CATALOG[1]);
  });
});
