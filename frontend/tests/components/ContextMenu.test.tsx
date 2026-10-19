import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import { ContextMenu } from "../../src/components/ContextMenu";
import { openContextMenu, closeContextMenu, type MenuItem } from "../../src/utils/contextMenu";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  closeContextMenu();
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  // render's own disposer: it makes its own root, so disposing an outer
  // createRoot left every earlier test's menu mounted and listening.
  dispose = render(() => <ContextMenu />, host);
};

const evAt = (x: number, y: number) =>
  ({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} }) as unknown as MouseEvent;

describe("ContextMenu", () => {
  it("renders nothing until a menu is opened", () => {
    mount();
    expect(host!.querySelector(".context-menu")).toBeNull();
  });

  it("draws a heading as a title, not as an item (audit A-18)", () => {
    mount();
    openContextMenu(evAt(5, 5), [
      { heading: true, label: "Servidor" },
      { label: "Monitor", action: () => {} },
    ]);
    const heading = host!.querySelector(".context-menu-heading")!;
    expect(heading.textContent).toBe("Servidor");
    expect(heading.getAttribute("role")).toBe("presentation");
    expect([...host!.querySelectorAll("[role=menuitem]")].map((b) => b.textContent)).toEqual(["Monitor"]);
  });

  it("renders items and runs an action then closes on click", () => {
    mount();
    const action = vi.fn();
    const items: MenuItem[] = [
      { label: "Uno", action },
      { separator: true },
      { label: "Dos", action: () => {} },
    ];
    openContextMenu(evAt(5, 5), items);
    const buttons = [...host!.querySelectorAll(".context-menu-item")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Uno", "Dos"]);
    expect(host!.querySelector(".context-menu-sep")).not.toBeNull();

    (buttons[0] as HTMLButtonElement).click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(host!.querySelector(".context-menu")).toBeNull(); // closed
  });

  it("does not fire a disabled item", () => {
    mount();
    const action = vi.fn();
    openContextMenu(evAt(0, 0), [{ label: "X", action, disabled: true }]);
    (host!.querySelector(".context-menu-item") as HTMLButtonElement).click();
    expect(action).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    mount();
    openContextMenu(evAt(0, 0), [{ label: "X", action: () => {} }]);
    expect(host!.querySelector(".context-menu")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host!.querySelector(".context-menu")).toBeNull();
  });
});

describe("ContextMenu placement (issue #318)", () => {
  // jsdom has no layout: every element measures 0x0, which is exactly the shape
  // of the bug (the clamp used to measure a still-detached element and so never
  // moved anything). Stub the box so the clamp has a real size to work with.
  const stubSize = (width: number, height: number) => {
    const proto = HTMLDivElement.prototype;
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: HTMLDivElement) {
      return this.classList?.contains("context-menu")
        ? ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height } as DOMRect)
        : original.call(this);
    };
    return () => {
      proto.getBoundingClientRect = original;
    };
  };
  const flush = () => new Promise((r) => queueMicrotask(() => r(null)));
  const menu = () => host!.querySelector<HTMLElement>(".context-menu")!;

  it("pulls a menu opened at the right edge back inside the window", async () => {
    const restore = stubSize(180, 120);
    try {
      mount();
      // jsdom's window is 1024x768.
      openContextMenu(evAt(1000, 40), [{ label: "CSV" }, { label: "JSON" }]);
      await flush();
      expect(menu().style.left).toBe(`${1024 - 180 - 4}px`);
      expect(menu().style.top).toBe("40px");
    } finally {
      restore();
    }
  });

  it("leaves a menu with room to spare at the click position", async () => {
    const restore = stubSize(180, 120);
    try {
      mount();
      openContextMenu(evAt(120, 60), [{ label: "CSV" }]);
      await flush();
      expect(menu().style.left).toBe("120px");
      expect(menu().style.top).toBe("60px");
    } finally {
      restore();
    }
  });
});

// Issue #687: the menu is a keyboard citizen — opened from the Menu key on the
// focused element, walked with the arrows, and it gives the focus back.
describe("ContextMenu from the keyboard", () => {
  const tick = () => new Promise<void>((r) => queueMicrotask(r));
  const key = (k: string) =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const rows = () => [...host!.querySelectorAll<HTMLButtonElement>(".context-menu-item")];

  it("opens on the Menu key at the focused element and focuses the first enabled item", async () => {
    mount();
    const opener = document.createElement("button");
    opener.textContent = "fila";
    opener.addEventListener("contextmenu", (e) =>
      openContextMenu(e, [
        { label: "Apagado", disabled: true },
        { label: "Uno", action: () => {} },
        { label: "Dos", action: () => {} },
      ]),
    );
    document.body.appendChild(opener);
    opener.focus();
    opener.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }),
    );
    await tick();
    expect(host!.querySelector(".context-menu")).not.toBeNull();
    expect(document.activeElement).toBe(rows()[1]);

    key("ArrowDown");
    expect(document.activeElement).toBe(rows()[2]);
    key("ArrowDown"); // wraps past the disabled first row
    expect(document.activeElement).toBe(rows()[1]);
    key("End");
    expect(document.activeElement).toBe(rows()[2]);
    key("Home");
    expect(document.activeElement).toBe(rows()[1]);

    key("Escape");
    expect(host!.querySelector(".context-menu")).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("activates the focused item with Enter and hands the focus back", async () => {
    mount();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const action = vi.fn();
    openContextMenu(evAt(5, 5), [{ label: "Uno", action }]);
    await tick();
    const row = rows()[0];
    expect(document.activeElement).toBe(row);
    row.click(); // what Enter does on a focused <button>
    expect(action).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("ContextMenu submenus (audit A-14)", () => {
  const tick = () => new Promise<void>((r) => queueMicrotask(r));
  const key = (k: string) =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const row = (text: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>(".context-menu-item")].find(
      (b) => b.textContent?.includes(text),
    )!;
  const items = (action = vi.fn()): MenuItem[] => [
    { label: "Copiar", action: () => {} },
    {
      label: "Copiar como",
      submenu: [
        { label: "TSV", action },
        { label: "Apagado", disabled: true },
        { label: "JSON", action: () => {} },
      ],
    },
    { label: "Eliminar", action: () => {} },
  ];

  it("marks the parent row as a menu opener and keeps its submenu closed", async () => {
    mount();
    openContextMenu(evAt(5, 5), items());
    await tick();
    const parent = row("Copiar como");
    expect(parent.getAttribute("aria-haspopup")).toBe("menu");
    expect(parent.getAttribute("aria-expanded")).toBe("false");
    expect(host!.querySelector(".context-submenu")).toBeNull();
  });

  it("opens with ArrowRight, walks only its own rows, and closes back to the parent", async () => {
    mount();
    openContextMenu(evAt(5, 5), items());
    await tick();
    key("ArrowDown"); // Copiar → Copiar como
    expect(document.activeElement).toBe(row("Copiar como"));
    key("ArrowRight");
    const sub = host!.querySelector(".context-submenu")!;
    expect(sub.getAttribute("role")).toBe("menu");
    expect(sub.getAttribute("aria-label")).toBe("Copiar como");
    expect(row("Copiar como").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(row("TSV"));
    key("ArrowDown"); // skips the disabled row, stays inside the submenu
    expect(document.activeElement).toBe(row("JSON"));
    key("ArrowDown"); // wraps within the submenu, not into the top menu
    expect(document.activeElement).toBe(row("TSV"));
    key("ArrowLeft");
    expect(host!.querySelector(".context-submenu")).toBeNull();
    expect(document.activeElement).toBe(row("Copiar como"));
  });

  it("Escape inside a submenu closes only the submenu; a second Escape closes the menu", async () => {
    mount();
    openContextMenu(evAt(5, 5), items());
    await tick();
    key("ArrowDown");
    key("ArrowRight");
    expect(document.activeElement).toBe(row("TSV"));
    key("Escape");
    expect(host!.querySelector(".context-menu")).not.toBeNull();
    expect(host!.querySelector(".context-submenu")).toBeNull();
    key("Escape");
    expect(host!.querySelector(".context-menu")).toBeNull();
  });

  it("opens on hover, closes when another row is hovered, and runs a submenu action", async () => {
    mount();
    const action = vi.fn();
    openContextMenu(evAt(5, 5), items(action));
    await tick();
    row("Copiar como").dispatchEvent(new MouseEvent("mouseenter"));
    expect(host!.querySelector(".context-submenu")).not.toBeNull();
    row("Eliminar").dispatchEvent(new MouseEvent("mouseenter"));
    expect(host!.querySelector(".context-submenu")).toBeNull();
    row("Copiar como").dispatchEvent(new MouseEvent("mouseenter"));
    row("TSV").click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(host!.querySelector(".context-menu")).toBeNull();
  });
});

// Audit P4 (R-29): real section headers and radio items.
describe("ContextMenu — headers and radio items", () => {
  it("draws a header as a label the arrows never land on", () => {
    mount();
    openContextMenu(evAt(0, 0), [{ label: "Bases de datos", heading: true }, { label: "main", action: () => {} }]);
    const header = host!.querySelector(".context-menu-heading")!;
    expect(header.textContent).toBe("Bases de datos");
    expect(header.getAttribute("role")).toBe("presentation");
    expect([...host!.querySelectorAll(".context-menu-item")].map((b) => b.textContent)).toEqual(["main"]);
  });

  it("makes a choice of a set a menuitemradio with aria-checked", () => {
    mount();
    const pick = vi.fn();
    openContextMenu(evAt(0, 0), [
      { label: "main", checked: true, action: () => {} },
      { label: "temp", checked: false, action: pick },
      { label: "Otra cosa", action: () => {} },
    ]);
    const radios = [...host!.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")];
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(radios[0].querySelector(".context-menu-radio.on")).not.toBeNull();
    expect(host!.querySelectorAll("[role=menuitem]")).toHaveLength(1);
    radios[1].click();
    expect(pick).toHaveBeenCalled();
  });
});
