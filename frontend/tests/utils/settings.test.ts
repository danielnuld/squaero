import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  clampSlowThreshold,
  rowHeightFor,
  MIN_SLOW_MS,
  MAX_SLOW_MS,
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

describe("rowHeightFor", () => {
  it("maps density to a pixel height", () => {
    expect(rowHeightFor("normal")).toBe(28);
    expect(rowHeightFor("compact")).toBe(22);
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
    const s = { gridDensity: "compact" as const, slowThresholdMs: 1200, checkUpdatesOnStart: false };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });

  it("fills missing fields with defaults (partial blob)", () => {
    const out = parseSettings(JSON.stringify({ gridDensity: "compact" }));
    expect(out.gridDensity).toBe("compact");
    expect(out.slowThresholdMs).toBe(DEFAULT_SETTINGS.slowThresholdMs);
    expect(out.checkUpdatesOnStart).toBe(DEFAULT_SETTINGS.checkUpdatesOnStart);
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
