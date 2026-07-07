import { describe, it, expect } from "vitest";
import {
  compareVersions,
  parseLatestRelease,
  checkForUpdate,
} from "../../src/utils/update";

describe("compareVersions", () => {
  it("orders by major.minor.patch", () => {
    expect(compareVersions("0.2.0", "0.1.1")).toBeGreaterThan(0);
    expect(compareVersions("0.1.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
  });
  it("compares numerically, not lexically", () => {
    expect(compareVersions("0.10.0", "0.2.0")).toBeGreaterThan(0);
  });
  it("ignores a leading v and missing parts", () => {
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
    expect(compareVersions("1", "0.9.9")).toBeGreaterThan(0);
  });
});

describe("parseLatestRelease", () => {
  const rel = {
    tag_name: "v0.2.0",
    body: "### Novedades\n- multi-conexión",
    html_url: "https://github.com/danielnuld/quaero/releases/tag/v0.2.0",
    assets: [
      { name: "quaero-0.2.0-x86.msi", browser_download_url: "https://x/quaero-0.2.0-x86.msi" },
      { name: "sha256.txt", browser_download_url: "https://x/sha256.txt" },
    ],
  };

  it("extracts version (no v), notes, url and the .msi asset", () => {
    expect(parseLatestRelease(rel)).toEqual({
      version: "0.2.0",
      notes: "### Novedades\n- multi-conexión",
      releaseUrl: "https://github.com/danielnuld/quaero/releases/tag/v0.2.0",
      downloadUrl: "https://x/quaero-0.2.0-x86.msi",
    });
  });
  it("returns a null downloadUrl when there is no .msi asset", () => {
    expect(parseLatestRelease({ tag_name: "v1.0.0", assets: [] })?.downloadUrl).toBeNull();
  });
  it("rejects a response without a tag", () => {
    expect(parseLatestRelease({ body: "x" })).toBeNull();
    expect(parseLatestRelease(null)).toBeNull();
  });
});

describe("checkForUpdate", () => {
  const okFetch = (body: unknown): typeof fetch =>
    (async () => ({ ok: true, json: async () => body }) as Response) as unknown as typeof fetch;

  it("returns the update when the release is newer", async () => {
    const info = await checkForUpdate("0.1.1", okFetch({ tag_name: "v0.2.0", assets: [] }));
    expect(info?.version).toBe("0.2.0");
  });
  it("returns null when up to date or older", async () => {
    expect(await checkForUpdate("0.2.0", okFetch({ tag_name: "v0.2.0" }))).toBeNull();
    expect(await checkForUpdate("0.3.0", okFetch({ tag_name: "v0.2.0" }))).toBeNull();
  });
  it("returns null for a dev build without fetching", async () => {
    let called = false;
    const spy: typeof fetch = (async () => {
      called = true;
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    expect(await checkForUpdate("dev", spy)).toBeNull();
    expect(called).toBe(false);
  });
  it("swallows a non-ok response and a network error", async () => {
    const notOk: typeof fetch = (async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", notOk)).toBeNull();
    const boom: typeof fetch = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await checkForUpdate("0.1.0", boom)).toBeNull();
  });
});
