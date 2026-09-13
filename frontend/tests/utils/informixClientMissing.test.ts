import { describe, it, expect } from "vitest";
import {
  INFORMIX_CLIENT_MISSING,
  INFORMIX_CSDK_URL,
  isInformixClientMissing,
} from "../../src/utils/errors";
import { QueryError } from "../../src/utils/query";

// The Informix driver marks a connect error when no IBM client is installed
// (issue #506); the UI turns that into install guidance instead of an ODBC code.

describe("isInformixClientMissing", () => {
  it("recognizes the driver's marker in a connection error from the core", () => {
    const err = new QueryError(
      "IFX_CLIENT_MISSING: the IBM Informix Client SDK (32-bit) was not found (looked in …) [connect: [IM002] …]",
      -32000,
    );
    expect(isInformixClientMissing(err)).toBe(true);
  });

  it("does not mistake other connection failures for it", () => {
    expect(isInformixClientMissing(new QueryError("connect: [08004] Attempt to connect failed", -32000))).toBe(false);
    expect(isInformixClientMissing(new QueryError("Login failed for user 'sa'.", -32000))).toBe(false);
    expect(isInformixClientMissing(new Error("network down"))).toBe(false);
    expect(isInformixClientMissing(undefined)).toBe(false);
  });

  it("keeps the marker the driver writes, and IBM's own download page", () => {
    // drivers/informix/src/utils/clientmissing.h defines the same text.
    expect(INFORMIX_CLIENT_MISSING).toBe("IFX_CLIENT_MISSING");
    expect(INFORMIX_CSDK_URL.startsWith("https://www.ibm.com/")).toBe(true);
  });
});
