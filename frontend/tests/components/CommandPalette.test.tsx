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

function mount(
  over: {
    open?: boolean;
    commands?: Command[];
    onClose?: () => void;
    footer?: string;
    emptySetLabel?: string;
  } = {},
) {
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
          footer={over.footer}
          emptySetLabel={over.emptySetLabel}
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

describe("CommandPalette — snippet mode (issue #320)", () => {
  const snippets = (alt?: (a: "shift" | "mod") => void): Command[] => [
    {
      id: "snip:1",
      category: "snippet",
      label: "cuadernos por año",
      preview: "SELECT * FROM cuadernos WHERE anio = 2026",
      run: () => {},
      runAlt: alt,
    },
    {
      id: "snip:2",
      category: "snippet",
      label: "carga por juzgado",
      preview: "SELECT juzgado, COUNT(*) FROM cuadernos GROUP BY 1",
      run: () => {},
      runAlt: alt,
    },
  ];
  const keyWith = (el: Element, k: string, mods: KeyboardEventInit) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...mods }));
  const input = () => host!.querySelector(".cmdk-input") as HTMLInputElement;

  it("shows the body of the highlighted snippet", () => {
    mount({ commands: snippets() });
    expect(host!.querySelector(".cmdk-preview")?.textContent).toContain("anio = 2026");
  });

  it("follows the highlight to the next snippet's body", () => {
    mount({ commands: snippets() });
    key(input(), "ArrowDown");
    expect(host!.querySelector(".cmdk-preview")?.textContent).toContain("GROUP BY");
  });

  it("Enter takes the primary action, Shift+Enter and Mod+Enter the alternates", () => {
    const alts: string[] = [];
    const run = vi.fn();
    const cmds = snippets((a) => alts.push(a));
    cmds[0].run = run;

    mount({ commands: cmds });
    key(input(), "Enter");
    expect(run).toHaveBeenCalledTimes(1);
    expect(alts).toEqual([]);

    mount({ commands: cmds });
    keyWith(input(), "Enter", { shiftKey: true });
    mount({ commands: cmds });
    keyWith(input(), "Enter", { ctrlKey: true });
    expect(alts).toEqual(["shift", "mod"]);
    // The alternates replace the primary action, they do not add to it.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to the primary action when a command offers no alternates", () => {
    const run = vi.fn();
    const cmds = snippets();
    cmds[0].run = run;
    mount({ commands: cmds });
    keyWith(input(), "Enter", { shiftKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("says the set is empty rather than showing 'no results'", () => {
    mount({ commands: [], emptySetLabel: "Aún no hay snippets guardados." });
    expect(host!.querySelector(".cmdk-empty")?.textContent).toBe(
      "Aún no hay snippets guardados.",
    );
  });

  it("still says 'no results' when the set has snippets but none match", () => {
    mount({ commands: snippets(), emptySetLabel: "Aún no hay snippets guardados." });
    input().value = "zzz";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    expect(host!.querySelector(".cmdk-empty")?.textContent).toBe("Sin resultados");
  });

  it("shows the key hints in the footer", () => {
    mount({ commands: snippets(), footer: "Enter insertar · Shift+Enter ejecutar" });
    expect(host!.querySelector(".cmdk-footer")?.textContent).toContain("Shift+Enter");
  });
});
