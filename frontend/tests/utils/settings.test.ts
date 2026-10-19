import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  clampSlowThreshold,
  rowHeightFor,
  MIN_SLOW_MS,
  MAX_SLOW_MS,
  clampLocalVersions,
  clampLocalDays,
  MAX_LOCAL_VERSIONS,
  MAX_LOCAL_DAYS,
} from "../../src/utils/settings";

describe("clampSlowThreshold", () => {
  it("clamps to [MIN_SLOW_MS, MAX_SLOW_MS] and rounds", () => {
    expect(clampSlowThreshold(-100)).toBe(MIN_SLOW_MS);
    expect(clampSlowThreshold(999_999_999)).toBe(MAX_SLOW_MS);
    expect(clampSlowThreshold(500.7)).toBe(501);
  });
  it("falls back to the default for non-finite input", () => {
    expect(clampSlowThreshold(NaN)).toBe(DEFAULT_SETTINGS.slowThresholdMs);
    // Infinity is not finite, so it falls back rather than clamping to MAX.
    expect(clampSlowThreshold(Infinity)).toBe(DEFAULT_SETTINGS.slowThresholdMs);
  });
});

describe("rowHeightFor (per style and density, issue #540)", () => {
  it("gives each style its own pair of heights", () => {
    expect(rowHeightFor("registro", "normal")).toBe(28);
    expect(rowHeightFor("registro", "compact")).toBe(24);
    expect(rowHeightFor("hoja", "normal")).toBe(22);
    expect(rowHeightFor("hoja", "compact")).toBe(20);
    expect(rowHeightFor("informe", "normal")).toBe(32);
    expect(rowHeightFor("informe", "compact")).toBe(28);
  });

  // A virtualized list punishes a mismatch: rows that measure one thing and
  // paint another leave gaps or overlap as you scroll.
  it("is compact <= normal for every style, and always a positive number", () => {
    for (const style of ["registro", "hoja", "informe"] as const) {
      const normal = rowHeightFor(style, "normal");
      const compact = rowHeightFor(style, "compact");
      expect(compact).toBeLessThanOrEqual(normal);
      expect(compact).toBeGreaterThan(0);
    }
  });
});


describe("parseSettings with a grid style (issue #540)", () => {
  // Settings saved before this existed must keep working, and land on the
  // default rather than on undefined.
  it("defaults the style when it is absent or unknown", () => {
    expect(parseSettings(JSON.stringify({ gridDensity: "compact" })).gridStyle).toBe("registro");
    expect(parseSettings(JSON.stringify({ gridStyle: "ninguno" })).gridStyle).toBe("registro");
    expect(parseSettings(JSON.stringify({ gridStyle: 7 })).gridStyle).toBe("registro");
  });

  it("keeps a style it recognises", () => {
    for (const style of ["registro", "hoja", "informe"] as const) {
      expect(parseSettings(JSON.stringify({ gridStyle: style })).gridStyle).toBe(style);
    }
  });
});

describe("parseSettings", () => {
  it("returns a fresh copy of defaults for null/empty", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    // Not the same reference (callers may mutate).
    expect(parseSettings(null)).not.toBe(DEFAULT_SETTINGS);
  });

  it("returns defaults on corrupt or non-object JSON", () => {
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[]")).toEqual(DEFAULT_SETTINGS); // arrays are not settings
  });

  it("round-trips a full settings object", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      gridDensity: "compact" as const,
      gridStyle: "informe" as const,
      slowThresholdMs: 1200,
      checkUpdatesOnStart: false,
      toolStrip: false,
      colorTypes: false,
      editorDiagnostics: false,
      builtinTemplates: false,
      localHistoryVersions: 7,
      localHistoryDays: 0,
      nativeMenu: false,
    };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });

  // Local-history retention (issue #674).
  it("clamps the local-history retention and defaults what is not a number", () => {
    const out = parseSettings(
      JSON.stringify({ localHistoryVersions: 99999, localHistoryDays: -3 }),
    );
    expect(out.localHistoryVersions).toBe(MAX_LOCAL_VERSIONS);
    expect(out.localHistoryDays).toBe(0);
    const bad = parseSettings(JSON.stringify({ localHistoryVersions: "10", localHistoryDays: null }));
    expect(bad.localHistoryVersions).toBe(DEFAULT_SETTINGS.localHistoryVersions);
    expect(bad.localHistoryDays).toBe(DEFAULT_SETTINGS.localHistoryDays);
  });

  it("clampLocalVersions / clampLocalDays keep 0 (off / no age limit) and floor", () => {
    expect(clampLocalVersions(0)).toBe(0);
    expect(clampLocalVersions(1.9)).toBe(1);
    expect(clampLocalVersions(NaN)).toBe(DEFAULT_SETTINGS.localHistoryVersions);
    expect(clampLocalDays(0)).toBe(0);
    expect(clampLocalDays(MAX_LOCAL_DAYS + 1)).toBe(MAX_LOCAL_DAYS);
    expect(clampLocalDays(Infinity)).toBe(DEFAULT_SETTINGS.localHistoryDays);
  });

  it("fills missing fields with defaults (partial blob)", () => {
    const out = parseSettings(JSON.stringify({ gridDensity: "compact" }));
    expect(out.gridDensity).toBe("compact");
    expect(out.slowThresholdMs).toBe(DEFAULT_SETTINGS.slowThresholdMs);
    expect(out.checkUpdatesOnStart).toBe(DEFAULT_SETTINGS.checkUpdatesOnStart);
    // A blob written before the tool strip existed gets it shown, not hidden:
    // the strip is how someone finds out the tools are there (issue #386).
    expect(out.toolStrip).toBe(true);
    // Diagnostics (#662) start on for a blob saved before they existed.
    expect(out.editorDiagnostics).toBe(true);
    // Settings saved before templates existed (#665) offer the built-ins.
    expect(out.builtinTemplates).toBe(true);
    // Likewise the native menu bar (issue #686): shown until switched off.
    expect(out.nativeMenu).toBe(true);
  });

  it("rejects ill-typed fields, clamping/falling back", () => {
    const out = parseSettings(
      JSON.stringify({ gridDensity: "huge", slowThresholdMs: -5, checkUpdatesOnStart: "yes" }),
    );
    expect(out.gridDensity).toBe(DEFAULT_SETTINGS.gridDensity); // unknown density
    expect(out.slowThresholdMs).toBe(MIN_SLOW_MS); // clamped from -5
    expect(out.checkUpdatesOnStart).toBe(DEFAULT_SETTINGS.checkUpdatesOnStart); // not a boolean
  });
});

describe("parseSettings typography (issue #681)", () => {
  it("defaults reproduce the stylesheet: system UI font, mono stack, 100% zoom", () => {
    const out = parseSettings("{}");
    expect(out.uiFont).toBe("");
    expect(out.uiFontSize).toBe(12);
    expect(out.editorFont).toBe("");
    expect(out.editorFontSize).toBe(13);
    expect(out.editorLineHeight).toBe(1.4);
    expect(out.editorLigatures).toBe(true);
    expect(out.gridFont).toBe("");
    expect(out.gridFontSize).toBe(12);
    expect(out.zoom).toBe(100);
  });

  it("round-trips a full typography blob", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      uiFont: '"Inter"',
      uiFontSize: 14,
      editorFont: '"JetBrains Mono"',
      editorFontSize: 15,
      editorLineHeight: 1.6,
      editorLigatures: false,
      gridFont: '"Fira Code", monospace',
      gridFontSize: 11,
      zoom: 125,
    };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });

  it("re-sanitizes fonts and clamps numbers on read", () => {
    const out = parseSettings(
      JSON.stringify({
        uiFont: "Arial; color: red",
        editorFont: "Fira Code, url(x)",
        gridFont: 42,
        uiFontSize: 200,
        editorFontSize: "big",
        editorLineHeight: 0,
        gridFontSize: 2,
        zoom: 999,
        editorLigatures: "no",
      }),
    );
    expect(out.uiFont).toBe("");
    expect(out.editorFont).toBe('"Fira Code"');
    expect(out.gridFont).toBe("");
    expect(out.uiFontSize).toBe(32);
    expect(out.editorFontSize).toBe(13);
    expect(out.editorLineHeight).toBe(1);
    expect(out.gridFontSize).toBe(8);
    expect(out.zoom).toBe(200);
    expect(out.editorLigatures).toBe(true);
  });

  it("rowHeightFor grows with the scale and stays whole", () => {
    expect(rowHeightFor("registro", "normal", 1)).toBe(28);
    expect(rowHeightFor("registro", "normal", 1.25)).toBe(35);
    expect(rowHeightFor("hoja", "compact", 0.8)).toBe(16);
    expect(rowHeightFor("informe", "normal", 1.1)).toBe(35);
  });
});
