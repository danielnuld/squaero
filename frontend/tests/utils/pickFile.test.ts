import { describe, it, expect, afterEach } from "vitest";
import { canPickFile, pickFile } from "../../src/utils/pickFile";

const host = globalThis as { quaeroPickFile?: unknown };

afterEach(() => {
  delete host.quaeroPickFile;
});

describe("pickFile", () => {
  it("reports no picker when the host binds none", async () => {
    expect(canPickFile()).toBe(false);
    expect(await pickFile("Clave privada SSH")).toBeNull();
  });

  it("returns the path the host dialog chose", async () => {
    host.quaeroPickFile = async (title: string) => "C:/keys/" + title + ".pem";
    expect(canPickFile()).toBe(true);
    expect(await pickFile("aws")).toBe("C:/keys/aws.pem");
  });

  it("is null when the user cancels", async () => {
    host.quaeroPickFile = async () => null;
    expect(await pickFile("aws")).toBeNull();
  });

  it("is null when the host dialog fails", async () => {
    host.quaeroPickFile = async () => {
      throw new Error("dialog failed");
    };
    expect(await pickFile("aws")).toBeNull();
  });
});
