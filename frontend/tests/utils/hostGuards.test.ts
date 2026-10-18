import { describe, it, expect, afterEach } from "vitest";
import {
  blocksBrowserDefault,
  installHostGuards,
  isEditableTarget,
} from "../../src/utils/hostGuards";
import { matchShortcut, type KeyEventLike } from "../../src/utils/shortcuts";

const key = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("blocksBrowserDefault", () => {
  it("blocks reload in every spelling the app does not bind", () => {
    expect(blocksBrowserDefault(key("r", { ctrlKey: true }), false)).toBe(true);
    expect(blocksBrowserDefault(key("R", { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(blocksBrowserDefault(key("r", { metaKey: true }), false, true)).toBe(true);
    expect(blocksBrowserDefault(key("F5", { ctrlKey: true }), false)).toBe(true);
  });

  it("only counts the platform's own accelerator key as Mod", () => {
    // Cmd is the browser's on a Mac; Ctrl+E/H/N/O there are text-system bindings.
    expect(blocksBrowserDefault(key("e", { ctrlKey: true }), true, true)).toBe(false);
    expect(blocksBrowserDefault(key("h", { ctrlKey: true }), false, true)).toBe(false);
    expect(blocksBrowserDefault(key("r", { ctrlKey: true }), false, true)).toBe(false);
    expect(blocksBrowserDefault(key("r", { metaKey: true }), false, true)).toBe(true);
    // And Meta (the Windows key) is not the browser's on Windows/Linux.
    expect(blocksBrowserDefault(key("r", { metaKey: true }), false, false)).toBe(false);
  });

  it("blocks the Mac history keys outside a text field only", () => {
    expect(blocksBrowserDefault(key("[", { metaKey: true }), false, true)).toBe(true);
    expect(blocksBrowserDefault(key("]", { metaKey: true }), false, true)).toBe(true);
    expect(blocksBrowserDefault(key("ArrowLeft", { metaKey: true }), false, true)).toBe(true);
    // The editor indents with Cmd+[/] and Cmd+arrow goes to the line's end.
    expect(blocksBrowserDefault(key("[", { metaKey: true }), true, true)).toBe(false);
    expect(blocksBrowserDefault(key("ArrowLeft", { metaKey: true }), true, true)).toBe(false);
    // Option+arrow is word movement everywhere on a Mac, never history.
    expect(blocksBrowserDefault(key("ArrowLeft", { altKey: true }), false, true)).toBe(false);
  });

  it("blocks zoom keys with or without Shift, and the browser's own function keys", () => {
    expect(blocksBrowserDefault(key("+", { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(blocksBrowserDefault(key("=", { ctrlKey: true }), false)).toBe(true);
    expect(blocksBrowserDefault(key("-", { ctrlKey: true }), false)).toBe(true);
    expect(blocksBrowserDefault(key("0", { metaKey: true }), false, true)).toBe(true);
    for (const fn of ["F3", "F6", "F7", "F11"]) {
      expect(blocksBrowserDefault(key(fn), false)).toBe(true);
    }
  });

  it("blocks open, new window, history, location, find-next and view source", () => {
    for (const k of ["o", "n", "h", "l", "g", "e", "u"]) {
      expect(blocksBrowserDefault(key(k, { ctrlKey: true }), false)).toBe(true);
    }
  });

  it("blocks Alt+arrows and the browser keys outside a text field only", () => {
    expect(blocksBrowserDefault(key("ArrowLeft", { altKey: true }), false)).toBe(true);
    expect(blocksBrowserDefault(key("ArrowRight", { altKey: true }), false)).toBe(true);
    expect(blocksBrowserDefault(key("ArrowLeft", { altKey: true }), true)).toBe(false);
    expect(blocksBrowserDefault(key("BrowserBack"), true)).toBe(true);
  });

  it("never takes a key the app binds itself", () => {
    const own: KeyEventLike[] = [
      key("F5"),
      key("F1"),
      key("p", { ctrlKey: true }),
      key("f", { ctrlKey: true }),
      key("k", { ctrlKey: true }),
      key("j", { ctrlKey: true }),
      key("s", { ctrlKey: true }),
      key("S", { ctrlKey: true, shiftKey: true }),
      key("t", { ctrlKey: true }),
      key("w", { ctrlKey: true }),
      key("l", { ctrlKey: true, altKey: true }),
      key("L", { ctrlKey: true, shiftKey: true }),
      key("O", { ctrlKey: true, shiftKey: true }),
      key("PageDown", { ctrlKey: true }),
    ];
    for (const e of own) {
      expect(matchShortcut(e), e.key).not.toBeNull();
      expect(blocksBrowserDefault(e, false), e.key).toBe(false);
    }
  });

  it("leaves plain typing and editing keys alone", () => {
    expect(blocksBrowserDefault(key("r"), true)).toBe(false);
    expect(blocksBrowserDefault(key("c", { ctrlKey: true }), true)).toBe(false);
    expect(blocksBrowserDefault(key("v", { ctrlKey: true }), true)).toBe(false);
    expect(blocksBrowserDefault(key("z", { ctrlKey: true }), true)).toBe(false);
    expect(blocksBrowserDefault(key("Enter", { ctrlKey: true }), true)).toBe(false);
    expect(blocksBrowserDefault(key("F12"), false)).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it("recognises inputs, textareas, selects and contenteditable", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    const div = document.createElement("div");
    expect(isEditableTarget(div)).toBe(false);
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isEditableTarget(div)).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });
});

describe("installHostGuards", () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  const fire = <E extends Event>(target: EventTarget, e: E): E => {
    target.dispatchEvent(e);
    return e;
  };

  it("cancels a browser-only key on the document and keeps the app's", () => {
    uninstall = installHostGuards(document);
    const reload = fire(
      document.body,
      new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(reload.defaultPrevented).toBe(true);
    const refresh = fire(
      document.body,
      new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true }),
    );
    expect(refresh.defaultPrevented).toBe(false);
  });

  it("lets Alt+Left through inside a text field", () => {
    uninstall = installHostGuards(document);
    const input = document.createElement("input");
    document.body.appendChild(input);
    const e = fire(
      input,
      new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true }),
    );
    expect(e.defaultPrevented).toBe(false);
    input.remove();
  });

  it("cancels Ctrl+wheel zoom and leaves plain scrolling alone", () => {
    uninstall = installHostGuards(document);
    const zoom = fire(document.body, new WheelEvent("wheel", { ctrlKey: true, bubbles: true, cancelable: true }));
    expect(zoom.defaultPrevented).toBe(true);
    const scroll = fire(document.body, new WheelEvent("wheel", { bubbles: true, cancelable: true }));
    expect(scroll.defaultPrevented).toBe(false);
  });

  it("refuses a drop nobody handled, so a file never navigates the page", () => {
    uninstall = installHostGuards(document);
    const over = fire(document.body, new Event("dragover", { bubbles: true, cancelable: true }));
    expect(over.defaultPrevented).toBe(true);
    const drop = fire(document.body, new Event("drop", { bubbles: true, cancelable: true }));
    expect(drop.defaultPrevented).toBe(true);
  });

  it("stays out of a drop a component already handled", () => {
    uninstall = installHostGuards(document);
    const zone = document.createElement("div");
    document.body.appendChild(zone);
    let seen = 0;
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      seen++;
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      seen++;
    });
    fire(zone, new Event("dragover", { bubbles: true, cancelable: true }));
    fire(zone, new Event("drop", { bubbles: true, cancelable: true }));
    expect(seen).toBe(2);
    zone.remove();
  });

  it("uninstalls cleanly", () => {
    const off = installHostGuards(document);
    off();
    const e = fire(
      document.body,
      new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(e.defaultPrevented).toBe(false);
  });
});
