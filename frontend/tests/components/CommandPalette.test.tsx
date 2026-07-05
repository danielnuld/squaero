import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { CommandPalette } from "../../src/components/CommandPalette";
import type { Command } from "../../src/utils/commandPalette";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeCommands(runs: Record<string, () => void> = {}): Command[] {
  return [
    { id: "act:new", category: "action", label: "Nueva consulta", run: runs["act:new"] ?? (() => {}) },
    { id: "tool:mon", category: "tool", label: "Monitor de servidor", run: runs["tool:mon"] ?? (() => {}) },
    { id: "obj:orders", category: "object", label: "orders", hint: "shop", run: runs["obj:orders"] ?? (() => {}) },
    { id: "obj:customers", category: "object", label: "customers", hint: "shop", run: runs["obj:customers"] ?? (() => {}) },
  ];
}

function mount(over: { open?: boolean; commands?: Command[]; onClose?: () => void } = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const [open, setOpen] = createSignal(over.open ?? true);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <CommandPalette
          open={open()}
          commands={over.commands ?? makeCommands()}
          onClose={over.onClose ?? (() => setOpen(false))}
        />
      ),
      host!,
    );
  });
  return { setOpen };
}

const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    mount({ open: false });
    expect(host!.querySelector(".cmdk")).toBeNull();
  });

  it("groups commands by category with section labels", () => {
    mount();
    const labels = [...host!.querySelectorAll(".cmdk-group-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Acciones", "Herramientas", "Objetos"]);
  });

  it("fuzzy-filters as the user types", () => {
    mount();
    const input = host!.querySelector(".cmdk-input") as HTMLInputElement;
    input.value = "cust";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const items = [...host!.querySelectorAll(".cmdk-item-label")].map((i) => i.textContent);
    expect(items).toEqual(["customers"]);
  });

  it("runs the active command on Enter and closes", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    mount({ commands: makeCommands({ "act:new": run }), onClose });
    const input = host!.querySelector(".cmdk-input") as HTMLInputElement;
    key(input, "Enter"); // first item (Nueva consulta) is active by default
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("moves the active row with ArrowDown and runs the right command", () => {
    const runMon = vi.fn();
    mount({ commands: makeCommands({ "tool:mon": runMon }) });
    const input = host!.querySelector(".cmdk-input") as HTMLInputElement;
    key(input, "ArrowDown"); // 0 -> 1 (Monitor)
    key(input, "Enter");
    expect(runMon).toHaveBeenCalled();
  });

  it("runs a command on click", () => {
    const runOrders = vi.fn();
    mount({ commands: makeCommands({ "obj:orders": runOrders }) });
    const orders = [...host!.querySelectorAll<HTMLButtonElement>(".cmdk-item")].find(
      (b) => b.textContent?.includes("orders") && !b.textContent?.includes("customers"),
    )!;
    orders.click();
    expect(runOrders).toHaveBeenCalled();
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    mount({ onClose });
    const input = host!.querySelector(".cmdk-input") as HTMLInputElement;
    key(input, "Escape");
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the backdrop closes; clicking the panel does not", () => {
    const onClose = vi.fn();
    mount({ onClose });
    (host!.querySelector(".cmdk") as HTMLElement).dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    expect(onClose).not.toHaveBeenCalled();
    (host!.querySelector(".cmdk-backdrop") as HTMLElement).dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an empty note when nothing matches", async () => {
    mount();
    const input = host!.querySelector(".cmdk-input") as HTMLInputElement;
    input.value = "zzqx";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(host!.querySelector(".cmdk-empty")).not.toBeNull();
  });
});
