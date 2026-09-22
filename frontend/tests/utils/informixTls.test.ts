import { describe, it, expect } from "vitest";
import { DRIVER_SCHEMAS } from "../../src/utils/connections";
import { needsCertificates, securityHint } from "../../src/utils/connectionFormSections";

// Informix TLS in the connection form over DRDA (issue #557): the driver's own
// modes, and a CA file that only the verifying modes ask for.

describe("Informix connection form — TLS", () => {
  const tls = DRIVER_SCHEMAS.informix.fields.find((f) => f.key === "tls");

  it("offers off plus the three modes of libdrda", () => {
    expect(tls?.type).toBe("select");
    expect(tls?.required).toBe(false);
    expect(tls?.options?.map((o) => o.value)).toEqual(["", "require", "verify-ca", "verify-full"]);
  });

  it("asks for the CA file only when the certificate is verified", () => {
    expect(DRIVER_SCHEMAS.informix.fields.find((f) => f.key === "tls_ca")?.type).toBe("file");
    expect(needsCertificates("")).toBe(false);
    expect(needsCertificates("require")).toBe(false);
    expect(needsCertificates("verify-ca")).toBe(true);
    expect(needsCertificates("verify-full")).toBe(true);
  });

  it("explains each mode", () => {
    expect(securityHint("tls", "")).toBe("cform.sec.tlsOff");
    expect(securityHint("tls", "require")).toBe("cform.sec.encrypted");
    expect(securityHint("tls", "verify-full")).toBe("cform.sec.verifyIdentity");
  });
});
