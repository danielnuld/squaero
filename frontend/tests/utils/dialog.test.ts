import { describe, it, expect } from "vitest";
import {
  enterPressesPrimary,
  orderActions,
  osFromPlatform,
  trapTarget,
  typedNameMatches,
} from "../../src/utils/dialog";

describe("osFromPlatform", () => {
  it("reads the platform strings the webviews report", () => {
    expect(osFromPlatform("Win32")).toBe("windows");
    expect(osFromPlatform("MacIntel")).toBe("macos");
    expect(osFromPlatform("Linux x86_64")).toBe("linux");
    expect(osFromPlatform("X11; FreeBSD amd64")).toBe("linux");
  });

  it("reads a user agent when the platform is empty", () => {
    expect(osFromPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)")).toBe("macos");
    expect(osFromPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
  });

  it("falls back to Windows for nothing or the unknown", () => {
    expect(osFromPlatform("")).toBe("windows");
    expect(osFromPlatform(undefined)).toBe("windows");
    expect(osFromPlatform("Haiku")).toBe("windows");
  });
});

describe("orderActions", () => {
  it("keeps the Windows order: primary first, Cancel last", () => {
    expect(orderActions("windows", ["Guardar", "Cancelar"])).toEqual(["Guardar", "Cancelar"]);
  });

  it("reverses it on macOS and Linux: Cancel first, primary last", () => {
    expect(orderActions("macos", ["Guardar", "Cancelar"])).toEqual(["Cancelar", "Guardar"]);
    expect(orderActions("linux", ["Guardar y conectar", "Guardar", "Cancelar"])).toEqual([
      "Cancelar",
      "Guardar",
      "Guardar y conectar",
    ]);
  });

  it("does not touch the list it was given", () => {
    const actions = ["a", "b"];
    orderActions("macos", actions);
    expect(actions).toEqual(["a", "b"]);
  });

  it("handles a lone or an empty row", () => {
    expect(orderActions("linux", ["Cerrar"])).toEqual(["Cerrar"]);
    expect(orderActions("macos", [])).toEqual([]);
  });
});

describe("enterPressesPrimary", () => {
  it("presses from a text field or from nowhere in particular", () => {
    expect(enterPressesPrimary({ tagName: "INPUT", type: "text" }, false)).toBe(true);
    expect(enterPressesPrimary({ tagName: "input" }, false)).toBe(true);
    expect(enterPressesPrimary({ tagName: "INPUT", type: "number" }, false)).toBe(true);
    expect(enterPressesPrimary({ tagName: "INPUT", type: "checkbox" }, false)).toBe(true);
    expect(enterPressesPrimary(null, false)).toBe(true);
  });

  it("never in a destructive dialog", () => {
    expect(enterPressesPrimary({ tagName: "INPUT", type: "text" }, true)).toBe(false);
    expect(enterPressesPrimary(null, true)).toBe(false);
  });

  it("leaves Enter to the controls that use it themselves", () => {
    for (const tagName of ["TEXTAREA", "BUTTON", "A", "SELECT", "DIV"]) {
      expect(enterPressesPrimary({ tagName }, false)).toBe(false);
    }
    expect(enterPressesPrimary({ tagName: "INPUT", type: "file" }, false)).toBe(false);
    expect(enterPressesPrimary({ tagName: "INPUT", type: "button" }, false)).toBe(false);
  });
});

describe("trapTarget", () => {
  const list = ["a", "b", "c"];

  it("wraps from the last to the first, and back", () => {
    expect(trapTarget(list, "c", false)).toBe("a");
    expect(trapTarget(list, "a", true)).toBe("c");
  });

  it("lets the browser move inside the list", () => {
    expect(trapTarget(list, "a", false)).toBeNull();
    expect(trapTarget(list, "b", true)).toBeNull();
  });

  it("pulls focus that escaped back in", () => {
    expect(trapTarget(list, null, false)).toBe("a");
    expect(trapTarget(list, "zz", true)).toBe("c");
  });

  it("does nothing without focusable elements", () => {
    expect(trapTarget([], null, false)).toBeNull();
  });
});

describe("typedNameMatches", () => {
  it("wants the exact name, forgiving only the surrounding spaces", () => {
    expect(typedNameMatches("clientes", "clientes")).toBe(true);
    expect(typedNameMatches("  clientes ", "clientes")).toBe(true);
    expect(typedNameMatches("Clientes", "clientes")).toBe(false);
    expect(typedNameMatches("client", "clientes")).toBe(false);
  });

  it("never matches an empty name", () => {
    expect(typedNameMatches("", "")).toBe(false);
  });
});
