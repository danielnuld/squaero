import { describe, it, expect, afterEach, vi } from "vitest";
import { APP_NAME, setShellTheme, setShellTitle, windowTitle } from "../../src/utils/shell";

const host = globalThis as { quaeroSetTitle?: unknown; quaeroSetTheme?: unknown };

afterEach(() => {
  delete host.quaeroSetTitle;
  delete host.quaeroSetTheme;
});

describe("windowTitle", () => {
  it("names the tab, the connection and the app", () => {
    expect(windowTitle("orders", "prod-db")).toBe("orders — prod-db — Squaero");
  });

  it("drops the parts that are missing", () => {
    expect(windowTitle(null, "prod-db")).toBe("prod-db — Squaero");
    expect(windowTitle("orders", undefined)).toBe("orders — Squaero");
    expect(windowTitle(undefined, null)).toBe(APP_NAME);
  });

  it("treats blank parts as missing, so no dash is left orphaned", () => {
    expect(windowTitle("  ", "")).toBe("Squaero");
    expect(windowTitle(" orders ", "  ")).toBe("orders — Squaero");
  });
});

describe("setShellTitle", () => {
  it("sets the document title and tells the shell when it is there", () => {
    const native = vi.fn();
    host.quaeroSetTitle = native;
    setShellTitle("orders — prod-db — Squaero");
    expect(document.title).toBe("orders — prod-db — Squaero");
    expect(native).toHaveBeenCalledWith("orders — prod-db — Squaero");
  });

  it("only sets the document title in a plain browser", () => {
    setShellTitle("Squaero");
    expect(document.title).toBe("Squaero");
  });
});

describe("setShellTheme", () => {
  it("reports the resolved theme to the shell", () => {
    const native = vi.fn();
    host.quaeroSetTheme = native;
    setShellTheme("dark");
    expect(native).toHaveBeenCalledWith("dark");
  });

  it("is a no-op without the shell", () => {
    expect(() => setShellTheme("light")).not.toThrow();
  });
});
