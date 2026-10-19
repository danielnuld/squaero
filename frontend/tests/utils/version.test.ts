import { describe, it, expect } from "vitest";
import { ABOUT_LINKS, REPO_URL, aboutReport, systemLine } from "../../src/utils/version";

describe("aboutReport", () => {
  it("lists app, core, protocol and system, one per line", () => {
    expect(aboutReport({ app: "0.40.0", core: "0.40.0", protocol: 8, system: "Windows 11" })).toBe(
      "Squaero 0.40.0\nlibdbcore 0.40.0\nIPC v8\nWindows 11",
    );
  });

  it("says an unanswered core as unknown, not blank", () => {
    expect(aboutReport({ app: "dev", core: null, protocol: null, system: "" })).toBe(
      "Squaero dev\nlibdbcore ?\nIPC ?\n",
    );
  });
});

describe("ABOUT_LINKS", () => {
  it("all point into the public repository", () => {
    for (const url of Object.values(ABOUT_LINKS)) expect(url.startsWith(REPO_URL)).toBe(true);
    expect(ABOUT_LINKS.thirdParty).toMatch(/THIRD-PARTY\.md$/);
  });
});

describe("systemLine", () => {
  it("names the OS and, when stated, the architecture", () => {
    expect(systemLine("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/120")).toBe("Windows · x64");
    expect(systemLine("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS");
    expect(systemLine("Linux aarch64", "Mozilla/5.0 (X11; Linux aarch64)")).toBe("Linux · arm64");
    expect(systemLine("", "")).toBe("?");
  });
});
