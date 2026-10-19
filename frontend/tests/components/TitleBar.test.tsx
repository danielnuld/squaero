import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { TitleBar } from "../../src/components/TitleBar";
import type { Menu } from "../../src/utils/nativeMenu";
import type { Os, WindowState } from "../../src/utils/titleBar";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
const shell = globalThis as { quaeroWindow?: unknown };

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete shell.quaeroWindow;
  document.documentElement.removeAttribute("data-backdrop");
});

const MENUS: Menu[] = [
  {
    label: "Archivo",
    items: [
      { id: "new-tab", label: "Nueva consulta", accel: "Ctrl+T" },
      { id: "act:reconnect", label: "Reconectar", enabled: false },
      { separator: true },
      { id: "quit", label: "Salir" },
    ],
  },
  { label: "Editar", items: [{ id: "editor-find", label: "Buscar", accel: "Ctrl+F" }] },
  { label: "Ayuda", items: [{ id: "toggle-help", label: "Atajos" }] },
];

/** A fake shell: records the commands, answers with `state`. */
function fakeShell(state: WindowState) {
  const fn = vi.fn((cmd: string) => Promise.resolve(cmd === "maximize" ? { ...state, maximized: true } : state));
  shell.quaeroWindow = fn;
  return fn;
}

function mount(os: Os, over: Partial<Parameters<typeof TitleBar>[0]> = {}) {
  const h = { onMenuAction: vi.fn(), onPalette: vi.fn(), onNotifications: vi.fn() };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <TitleBar
          os={os}
          custom
          showMenu
          menus={MENUS}
          backdrop
          paletteKeys="Ctrl+K"
          unread={0}
          notesOpen={false}
          {...h}
          {...over}
        />
      ),
      host!,
    );
  });
  return h;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const bar = () => host!.querySelector(".titlebar") as HTMLElement;
const tops = () => [...host!.querySelectorAll<HTMLButtonElement>(".tb-menu-top")];
const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));

const WIN: WindowState = { os: "windows", frameless: true, maximized: false, backdrop: "mica" };

describe("TitleBar", () => {
  it("without a shell draws the in-app bar: brand, search, bell — no menu, no buttons", () => {
    const h = mount("linux", { unread: 3 });
    expect(bar().dataset.os).toBe("linux");
    expect(host!.querySelector(".tb-name")?.textContent).toBe("Squaero");
    expect(host!.querySelector(".tb-menubar")).toBeNull();
    expect(host!.querySelector(".tb-winbtns")).toBeNull();
    const search = host!.querySelector(".tb-search") as HTMLButtonElement;
    expect(search.textContent).toContain("Ctrl+K");
    search.click();
    expect(h.onPalette).toHaveBeenCalledOnce();
    const bell = host!.querySelector(".tb-bell") as HTMLButtonElement;
    expect(bell.title).toBe("Notificaciones: 3 sin leer");
    expect(bell.querySelector(".tb-badge")?.textContent).toBe("3");
    bell.click();
    expect(h.onNotifications).toHaveBeenCalledOnce();
  });

  it("caps the unread badge at 9+", () => {
    mount("linux", { unread: 12 });
    expect(host!.querySelector(".tb-badge")?.textContent).toBe("9+");
  });

  it("on Windows sends the setting to the shell and draws what the shell answers", async () => {
    const fn = fakeShell(WIN);
    mount("windows");
    await flush();
    expect(fn).toHaveBeenCalledWith("frameless", true);
    expect(tops().map((b) => b.textContent)).toEqual(["Archivo", "Editar", "Ayuda"]);
    expect(host!.querySelectorAll(".tb-winbtn")).toHaveLength(3);
    // The maximize button's place, for Snap layouts.
    expect(fn.mock.calls.some((c) => c[0] === "snap")).toBe(true);
    // Mica shows through the chrome, only because the style allows it.
    expect(document.documentElement.getAttribute("data-backdrop")).toBe("mica");
  });

  it("keeps the page opaque for a style without the backdrop", async () => {
    fakeShell(WIN);
    mount("windows", { backdrop: false });
    await flush();
    expect(document.documentElement.hasAttribute("data-backdrop")).toBe(false);
  });

  it("the fallback asks for the system frame and draws neither menu nor buttons", async () => {
    const fn = fakeShell({ ...WIN, frameless: false, backdrop: "none" });
    mount("windows", { custom: false });
    await flush();
    expect(fn).toHaveBeenCalledWith("frameless", false);
    expect(host!.querySelector(".tb-menubar")).toBeNull();
    expect(host!.querySelector(".tb-winbtns")).toBeNull();
  });

  it("wires minimize, maximize (then restore) and close to the shell", async () => {
    const fn = fakeShell(WIN);
    mount("windows");
    await flush();
    const [min, max, close] = [...host!.querySelectorAll<HTMLButtonElement>(".tb-winbtn")];
    expect(max.getAttribute("aria-label")).toBe("Maximizar");
    min.click();
    close.click();
    expect(fn).toHaveBeenCalledWith("minimize");
    expect(fn).toHaveBeenCalledWith("close");
    // The shell pushes the new state when the window is maximized.
    max.click();
    expect(fn).toHaveBeenCalledWith("maximize");
    window.dispatchEvent(new CustomEvent("quaero-window", { detail: { ...WIN, maximized: true } }));
    expect(max.getAttribute("aria-label")).toBe("Restaurar");
    // The Snap helper over the button reports the hover.
    window.dispatchEvent(new CustomEvent("quaero-window", { detail: { maxHover: true } }));
    expect(max.classList.contains("hover")).toBe(true);
  });

  it("drags from the empty bar, maximizes on a double click, never from a control", async () => {
    const fn = fakeShell(WIN);
    mount("windows");
    await flush();
    fn.mockClear();
    bar().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    bar().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 2 }));
    host!.querySelector(".tb-search")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    bar().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(fn.mock.calls.map((c) => c[0])).toEqual(["drag", "double-click", "system-menu"]);
  });

  it("does not drag with the system frame", () => {
    mount("linux");
    const fn = vi.fn();
    shell.quaeroWindow = fn;
    bar().dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 1 }));
    expect(fn).not.toHaveBeenCalled();
  });

  it("opens a menu on click and runs an item with the app's handler", async () => {
    fakeShell(WIN);
    const h = mount("windows");
    await flush();
    tops()[0].click();
    const menu = host!.querySelector('[role="menu"]')!;
    expect(menu.getAttribute("aria-label")).toBe("Archivo");
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((b) => b.textContent)).toEqual(["Nueva consultaCtrl+T", "Reconectar", "Salir"]);
    expect(items[1].disabled).toBe(true);
    items[0].click();
    expect(h.onMenuAction).toHaveBeenCalledWith("new-tab");
    expect(host!.querySelector('[role="menu"]')).toBeNull();
  });

  it("quits through the window's close, so the placement is saved", async () => {
    const fn = fakeShell(WIN);
    const h = mount("windows");
    await flush();
    tops()[0].click();
    [...host!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')][2].click();
    expect(fn).toHaveBeenCalledWith("close");
    expect(h.onMenuAction).not.toHaveBeenCalled();
  });

  it("underlines the access keys and opens a menu with Alt+key", async () => {
    fakeShell(WIN);
    mount("windows");
    await flush();
    expect([...host!.querySelectorAll(".tb-access")].map((e) => e.textContent)).toEqual(["A", "E", "y"]);
    key(document.body, "y", { altKey: true });
    expect(host!.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("Ayuda");
    // Ctrl+Alt (AltGr) is someone else's shortcut.
    key(tops()[2], "Escape");
    expect(host!.querySelector('[role="menu"]')).toBeNull();
    key(document.body, "a", { altKey: true, ctrlKey: true });
    expect(host!.querySelector('[role="menu"]')).toBeNull();
  });

  it("moves through items with the arrows, skipping disabled ones, and across menus", async () => {
    fakeShell(WIN);
    const h = mount("windows");
    await flush();
    key(tops()[0], "ArrowDown");
    const active = () => host!.querySelector(".tb-menu .context-menu-item.active")?.textContent;
    expect(active()).toBe("Nueva consultaCtrl+T");
    key(tops()[0], "ArrowDown");
    expect(active()).toBe("Salir");
    key(tops()[0], "ArrowRight");
    expect(host!.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe("Editar");
    expect(active()).toBe("BuscarCtrl+F");
    key(tops()[1], "Enter");
    expect(h.onMenuAction).toHaveBeenCalledWith("editor-find");
  });

  it("closes the open menu with Escape and on a click elsewhere", async () => {
    fakeShell(WIN);
    mount("windows");
    await flush();
    tops()[1].click();
    key(tops()[1], "Escape");
    expect(host!.querySelector('[role="menu"]')).toBeNull();
    tops()[1].click();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(host!.querySelector('[role="menu"]')).toBeNull();
  });

  it("on macOS leaves room for the traffic lights and has no menu of its own", async () => {
    fakeShell({ ...WIN, os: "macos", backdrop: "none" });
    mount("macos");
    await flush();
    expect(host!.querySelector(".tb-lights")).not.toBeNull();
    expect(host!.querySelector(".tb-menubar")).toBeNull();
    expect(host!.querySelector(".tb-winbtns")).toBeNull();
  });
});
