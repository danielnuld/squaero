import { describe, it, expect } from "vitest";
import {
  FALLBACK_SECTION,
  formSections,
  isKnownField,
  needsCertificates,
  sectionOf,
  sectionStatus,
  securityHint,
  type FormSection,
} from "../../src/utils/connectionFormSections";
import {
  DRIVER_SCHEMAS,
  driverSchema,
  fieldErrors,
  type Connection,
} from "../../src/utils/connections";

const conn = (driver: string, params: Record<string, string> = {}): Connection => ({
  id: "c1",
  name: "",
  driver,
  params,
});

const sectionsOf = (driver: string) => formSections(driverSchema(driver)!);
const ids = (driver: string) => sectionsOf(driver).map((s) => s.id);
const section = (driver: string, id: string): FormSection =>
  sectionsOf(driver).find((s) => s.id === id)!;

describe("formSections", () => {
  // The guard the design asks for: a field that is not in the map still renders
  // (it falls back to "server"), which means a driver could gain a field and
  // have it quietly filed under the wrong heading forever. Asserting the section
  // would not catch it — only asking whether it was mapped ON PURPOSE does.
  it("maps every field of every shipped schema on purpose", () => {
    const unmapped: string[] = [];
    for (const schema of Object.values(DRIVER_SCHEMAS)) {
      for (const field of schema.fields) {
        if (!isKnownField(field.key)) unmapped.push(`${schema.driver}.${field.key}`);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it("files an unknown key under the fallback instead of dropping it", () => {
    expect(sectionOf("some_new_driver_option")).toBe(FALLBACK_SECTION);
    expect(FALLBACK_SECTION).toBe("server");
  });

  it("orders the sections the same way for every engine", () => {
    expect(ids("mysql")).toEqual(["server", "auth", "security", "ssh"]);
    expect(ids("postgres")).toEqual(["server", "auth", "security", "ssh"]);
    expect(ids("mssql")).toEqual(["server", "auth", "security", "ssh"]);
  });

  // SQLite is a file on disk: no host, no user, no tunnel. Empty headings would
  // be worse than no headings.
  it("gives SQLite a file section and nothing about servers", () => {
    expect(ids("sqlite")).toEqual(["file"]);
    expect(section("sqlite", "file").fields.map((f) => f.key)).toEqual(["path"]);
  });

  it("puts each engine's own spelling of security in the security section", () => {
    const keys = (driver: string) => section(driver, "security").fields.map((f) => f.key);
    expect(keys("mysql")).toContain("ssl_mode");
    expect(keys("postgres")).toContain("sslmode");
    expect(keys("informix")).toContain("protocol");
    expect(keys("mongodb")).toContain("tls");
    expect(keys("mssql")).toContain("encryption");
  });

  it("keeps Informix's instance name with the server, not with the credentials", () => {
    expect(section("informix", "server").fields.map((f) => f.key)).toEqual([
      "host",
      "port",
      "server",
    ]);
    expect(section("informix", "auth").fields.map((f) => f.key)).toEqual([
      "database",
      "user",
      "password",
    ]);
  });

  it("loses no field along the way", () => {
    for (const schema of Object.values(DRIVER_SCHEMAS)) {
      const laid = formSections(schema).flatMap((s) => s.fields.map((f) => f.key));
      expect(laid.sort()).toEqual(schema.fields.map((f) => f.key).sort());
    }
  });
});

describe("sectionStatus", () => {
  const opts = { tried: false, sshOn: false };

  it("calls a section with everything required filled in ok", () => {
    const c = conn("mysql", { host: "127.0.0.1", port: "3306" });
    expect(sectionStatus(section("mysql", "server"), c, fieldErrors(c), opts)).toBe("ok");
  });

  it("calls a section with something still missing pending", () => {
    const c = conn("mysql", {});
    expect(sectionStatus(section("mysql", "server"), c, fieldErrors(c), opts)).toBe("pending");
  });

  // A brand-new form greeting you with three complaints about fields you have
  // not reached is exactly what this avoids: red only after trying.
  it("only turns red once the user has tried to save", () => {
    const c = conn("mysql", {});
    const errors = fieldErrors(c);
    expect(sectionStatus(section("mysql", "server"), c, errors, opts)).toBe("pending");
    expect(sectionStatus(section("mysql", "server"), c, errors, { ...opts, tried: true })).toBe(
      "error",
    );
  });

  it("marks a filled-in but invalid field as an error after trying", () => {
    const c = conn("mysql", { host: "127.0.0.1", port: "no-es-un-numero" });
    const errors = fieldErrors(c);
    expect(sectionStatus(section("mysql", "server"), c, errors, { ...opts, tried: true })).toBe(
      "error",
    );
  });

  it("calls a section with nothing required ok, even empty", () => {
    const c = conn("mysql", {});
    expect(sectionStatus(section("mysql", "security"), c, fieldErrors(c), opts)).toBe("ok");
  });

  it("says the tunnel is off rather than incomplete", () => {
    const c = conn("mysql", {});
    expect(sectionStatus(section("mysql", "ssh"), c, fieldErrors(c), opts)).toBe("off");
  });

  // With the switch on, ssh_host stops being optional — the one state the schema
  // cannot express, since the model has no flag for the tunnel.
  it("wants a host once the tunnel is switched on", () => {
    const c = conn("mysql", {});
    const errors = fieldErrors(c, { sshRequired: true });
    const ssh = section("mysql", "ssh");
    expect(sectionStatus(ssh, c, errors, { tried: false, sshOn: true })).toBe("pending");
    expect(sectionStatus(ssh, c, errors, { tried: true, sshOn: true })).toBe("error");

    const withHost = conn("mysql", { ssh_host: "bastion" });
    expect(
      sectionStatus(ssh, withHost, fieldErrors(withHost, { sshRequired: true }), {
        tried: true,
        sshOn: true,
      }),
    ).toBe("ok");
  });
});

describe("securityHint", () => {
  it("explains what each verification level actually checks", () => {
    expect(securityHint("ssl_mode", "verify_ca")).toBe("cform.sec.verifyCa");
    expect(securityHint("sslmode", "verify-ca")).toBe("cform.sec.verifyCa");
    expect(securityHint("ssl_mode", "verify_identity")).toBe("cform.sec.verifyIdentity");
    expect(securityHint("sslmode", "verify-full")).toBe("cform.sec.verifyIdentity");
  });

  it("says plainly when nothing is encrypted", () => {
    expect(securityHint("ssl_mode", "disabled")).toBe("cform.sec.none");
    expect(securityHint("sslmode", "disable")).toBe("cform.sec.none");
    expect(securityHint("encryption", "off")).toBe("cform.sec.none");
  });

  // The empty value means "whatever the client defaults to", and that differs
  // per engine — so it is the one keyed by field rather than by value.
  it("gives each engine its own line for the default", () => {
    expect(securityHint("ssl_mode", "")).toBe("cform.sec.mysqlDefault");
    expect(securityHint("sslmode", "")).toBe("cform.sec.pgDefault");
    expect(securityHint("protocol", "")).toBe("cform.sec.ifxDefault");
    expect(securityHint("tls", "")).toBe("cform.sec.tlsOff");
    expect(securityHint("encryption", "")).toBe("cform.sec.encDefault");
  });

  it("never leaves a blank line for a value added later", () => {
    expect(securityHint("ssl_mode", "some_future_mode")).toBe("cform.sec.mysqlDefault");
    expect(securityHint("unknown_field", "unknown_value")).toBe("cform.sec.none");
  });

  it("covers every value the shipped schemas offer", () => {
    for (const schema of Object.values(DRIVER_SCHEMAS)) {
      for (const field of schema.fields) {
        if (sectionOf(field.key) !== "security" || !field.options) continue;
        for (const option of field.options) {
          expect(securityHint(field.key, option.value), `${field.key}=${option.value}`)
            .toMatch(/^cform\.sec\./);
        }
      }
    }
  });
});

describe("needsCertificates", () => {
  it("asks for certificates exactly where the driver can check them", () => {
    expect(needsCertificates("verify_ca")).toBe(true);
    expect(needsCertificates("verify_identity")).toBe(true);
    expect(needsCertificates("verify-ca")).toBe(true);
    expect(needsCertificates("verify-full")).toBe(true);
  });

  // Encrypting is not verifying: Informix checks against its Client SDK's own
  // keystore and SQL Server's db-lib takes no CA file, so offering empty
  // certificate boxes there would promise a check the driver cannot make.
  it("does not offer certificate fields where nothing would read them", () => {
    expect(needsCertificates("")).toBe(false);
    expect(needsCertificates("required")).toBe(false);
    expect(needsCertificates("require")).toBe(false);
    expect(needsCertificates("onsocssl")).toBe(false);
    expect(needsCertificates("strict")).toBe(false);
    expect(needsCertificates("true")).toBe(false);
  });
});
