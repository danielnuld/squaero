import { describe, it, expect } from "vitest";
import { DRIVER_SCHEMAS } from "../../src/utils/connections";

// Informix TLS in the connection form (issue #144): a protocol choice the driver
// passes through to the connection string, onsoctcp by default.

describe("Informix connection form — TLS", () => {
  const protocol = DRIVER_SCHEMAS.informix.fields.find((f) => f.key === "protocol");

  it("offers the SSL protocol next to the plain default", () => {
    expect(protocol?.type).toBe("select");
    expect(protocol?.required).toBe(false);
    // Empty = the driver's default (onsoctcp); onsocssl is the TLS listener.
    expect(protocol?.options?.map((o) => o.value)).toEqual(["", "onsocssl"]);
  });

  it("has no CA field: the keystore is the Client SDK's machine configuration", () => {
    const keys = DRIVER_SCHEMAS.informix.fields.map((f) => f.key);
    expect(keys.some((k) => /ca|cert|keystore/i.test(k))).toBe(false);
  });
});
