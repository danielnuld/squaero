import { describe, it, expect, vi, afterEach } from "vitest";
import { saveText, saveBytes } from "../../src/utils/download";

// saveText prefers the native save dialog (File System Access API) and falls
// back to an anchor download. These drive both paths without a real file system.

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.showSaveFilePicker;
  vi.restoreAllMocks();
});

describe("saveText — native save dialog", () => {
  it("writes content through showSaveFilePicker when available", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const picker = vi.fn().mockResolvedValue({ createWritable });
    g.showSaveFilePicker = picker;

    await saveText("customers.csv", "a,b\n1,2\n", "text/csv");

    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.calls[0][0].suggestedName).toBe("customers.csv");
    expect(picker.mock.calls[0][0].types[0].accept).toEqual({ "text/csv": [".csv"] });
    expect(write).toHaveBeenCalledWith("a,b\n1,2\n");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does nothing (no fallback) when the user cancels the dialog", async () => {
    const picker = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));
    g.showSaveFilePicker = picker;
    const created: string[] = [];
    const spy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        created.push(tag);
        return document.createElementNS("http://www.w3.org/1999/xhtml", tag) as HTMLElement;
      });

    await saveText("x.csv", "data", "text/csv");

    expect(picker).toHaveBeenCalledTimes(1);
    expect(created).not.toContain("a"); // no anchor download fallback
    spy.mockRestore();
  });
});

describe("saveText — anchor fallback", () => {
  it("triggers a browser download when the picker is unavailable", async () => {
    // No showSaveFilePicker on globalThis.
    (g as { URL: typeof URL }).URL.createObjectURL = vi.fn(() => "blob:x");
    (g as { URL: typeof URL }).URL.revokeObjectURL = vi.fn();
    const click = vi.fn();
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = orig(tag) as HTMLElement;
      if (tag === "a") (el as HTMLAnchorElement).click = click;
      return el;
    });

    await saveText("out.json", "{}", "application/json");

    expect(click).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("saveBytes — binary export (XLSX)", () => {
  it("writes a Blob through showSaveFilePicker when available", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const picker = vi.fn().mockResolvedValue({ createWritable });
    g.showSaveFilePicker = picker;

    await saveBytes("data.xlsx", new Uint8Array([80, 75, 3, 4]), "application/xlsx");

    expect(picker.mock.calls[0][0].suggestedName).toBe("data.xlsx");
    expect(picker.mock.calls[0][0].types[0].accept).toEqual({ "application/xlsx": [".xlsx"] });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("falls back to an anchor download when the picker is unavailable", async () => {
    (g as { URL: typeof URL }).URL.createObjectURL = vi.fn(() => "blob:x");
    (g as { URL: typeof URL }).URL.revokeObjectURL = vi.fn();
    const click = vi.fn();
    const orig = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = orig(tag) as HTMLElement;
      if (tag === "a") (el as HTMLAnchorElement).click = click;
      return el;
    });

    await saveBytes("data.xlsx", new Uint8Array([1, 2, 3]), "application/xlsx");

    expect(click).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
