import { describe, it, expect, afterEach } from "vitest";
import { canInstall, installUpdate } from "../../src/utils/installUpdate";

type Host = { quaeroDownloadAndInstall?: (url: string) => Promise<{ ok: boolean }> };
const host = globalThis as Host;

afterEach(() => {
  delete host.quaeroDownloadAndInstall;
});

describe("installUpdate", () => {
  it("reports unavailable and returns false without the native bridge", async () => {
    expect(canInstall()).toBe(false);
    expect(await installUpdate("https://x/q.msi")).toBe(false);
  });

  it("returns true when the bridge resolves ok", async () => {
    host.quaeroDownloadAndInstall = async () => ({ ok: true });
    expect(canInstall()).toBe(true);
    expect(await installUpdate("https://x/q.msi")).toBe(true);
  });

  it("returns false when the bridge reports not-ok or rejects", async () => {
    host.quaeroDownloadAndInstall = async () => ({ ok: false });
    expect(await installUpdate("https://x/q.msi")).toBe(false);
    host.quaeroDownloadAndInstall = async () => {
      throw new Error("network");
    };
    expect(await installUpdate("https://x/q.msi")).toBe(false);
  });
});
