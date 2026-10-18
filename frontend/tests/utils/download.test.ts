import { describe, it, expect, vi, afterEach } from "vitest";
import {
  pickDirectory,
  saveText,
  saveBytes,
  sqlFileName,
  writeFilesToDirectory,
  type DirectoryHandleLike,
} from "../../src/utils/download";

// saveText prefers the native save dialog (File System Access API) and falls
// back to an anchor download. These drive both paths without a real file system.

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.showSaveFilePicker;
  delete g.showDirectoryPicker;
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

describe("sqlFileName", () => {
  it("names the file after the tab, without what Windows forbids", () => {
    expect(sqlFileName("Consulta 1")).toBe("Consulta 1.sql");
    expect(sqlFileName("db:owner.tabla")).toBe("dbowner.tabla.sql");
    expect(sqlFileName("reporte.sql")).toBe("reporte.sql");
    expect(sqlFileName(' <?> ')).toBe("consulta.sql");
  });
});

describe("pickDirectory", () => {
  it("is undefined where the webview has no folder picker", async () => {
    expect(await pickDirectory()).toBeUndefined();
  });

  it("asks for a writable folder", async () => {
    const handle = { name: "repo" };
    const picker = vi.fn().mockResolvedValue(handle);
    g.showDirectoryPicker = picker;
    expect(await pickDirectory()).toBe(handle);
    expect(picker).toHaveBeenCalledWith({ mode: "readwrite" });
  });

  it("is null when the user dismisses the dialog", async () => {
    g.showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException("x", "AbortError"));
    expect(await pickDirectory()).toBeNull();
  });

  it("falls back (undefined) when the picker is blocked", async () => {
    g.showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException("x", "SecurityError"));
    expect(await pickDirectory()).toBeUndefined();
  });
});

describe("writeFilesToDirectory", () => {
  /** An in-memory folder: path -> content. */
  function fakeDir(files: Record<string, string>, prefix = ""): DirectoryHandleLike {
    return {
      name: prefix || "root",
      getDirectoryHandle: async (name, opts) => {
        expect(opts.create).toBe(true);
        return fakeDir(files, `${prefix}${name}/`);
      },
      getFileHandle: async (name) => ({
        createWritable: async () => {
          let buf = "";
          return {
            write: async (d: string | Blob) => {
              buf += d as string;
            },
            close: async () => {
              files[prefix + name] = buf;
            },
          };
        },
      }),
    };
  }

  it("writes every file under its subfolders and reports progress", async () => {
    const disk: Record<string, string> = {};
    const done: number[] = [];
    await writeFilesToDirectory(
      fakeDir(disk),
      [
        { path: "tables/a.sql", content: "A;" },
        { path: "views/v.sql", content: "V;" },
        { path: "top.sql", content: "T;" },
      ],
      (n) => done.push(n),
    );
    expect(disk).toEqual({ "tables/a.sql": "A;", "views/v.sql": "V;", "top.sql": "T;" });
    expect(done).toEqual([1, 2, 3]);
  });
});
