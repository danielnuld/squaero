import { describe, it, expect } from "vitest";
import { formatClock, formatDuration, formatElapsed, isSlow } from "../../src/utils/duration";

describe("formatDuration", () => {
  it("shows whole ms below a second", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(834.6)).toBe("835 ms");
    expect(formatDuration(999)).toBe("999 ms");
  });
  it("shows seconds with one decimal from 1s to under a minute", () => {
    expect(formatDuration(1000)).toBe("1.0 s");
    expect(formatDuration(1234)).toBe("1.2 s");
    expect(formatDuration(59_900)).toBe("59.9 s");
  });
  it("shows minutes and seconds at/above a minute", () => {
    expect(formatDuration(60_000)).toBe("1 m 0 s");
    expect(formatDuration(65_000)).toBe("1 m 5 s");
  });
  it("renders a dash for invalid input", () => {
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(NaN)).toBe("—");
  });
});

describe("isSlow", () => {
  it("is true only when duration meets/exceeds a positive threshold", () => {
    expect(isSlow(1500, 1000)).toBe(true);
    expect(isSlow(1000, 1000)).toBe(true);
    expect(isSlow(999, 1000)).toBe(false);
  });
  it("is disabled by a zero (or negative) threshold", () => {
    expect(isSlow(9999, 0)).toBe(false);
    expect(isSlow(9999, -5)).toBe(false);
  });
  it("treats missing/invalid duration as not slow", () => {
    expect(isSlow(undefined, 1000)).toBe(false);
    expect(isSlow(NaN, 1000)).toBe(false);
  });
});

// Issue #643: when a query ran, in the run toast and the status bar.
describe("formatClock", () => {
  it("renders local time as zero-padded HH:MM:SS, 24-hour", () => {
    expect(formatClock(new Date(2026, 9, 12, 14, 3, 5).getTime())).toBe("14:03:05");
    expect(formatClock(new Date(2026, 0, 1, 0, 0, 0).getTime())).toBe("00:00:00");
    expect(formatClock(new Date(2026, 0, 1, 23, 59, 59).getTime())).toBe("23:59:59");
  });
  it("renders a dash for an invalid timestamp", () => {
    expect(formatClock(NaN)).toBe("—");
  });
});

describe("formatElapsed", () => {
  it("reads minutes and seconds while under an hour", () => {
    expect(formatElapsed(4_000)).toBe("00:04");
    expect(formatElapsed(4_999)).toBe("00:04");
    expect(formatElapsed(65_000)).toBe("01:05");
    expect(formatElapsed(3_599_000)).toBe("59:59");
  });

  it("adds the hours from an hour on", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });

  it("is a clock at zero for nothing yet, a negative or a NaN", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(-5)).toBe("00:00");
    expect(formatElapsed(NaN)).toBe("00:00");
  });
});
