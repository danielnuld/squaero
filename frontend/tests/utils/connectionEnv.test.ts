import { describe, it, expect } from "vitest";
import { CONN_ENVS, ENV_DEFAULTS, parseEnv, stripeColor, withEnv } from "../../src/utils/connectionEnv";
import { CONNECTION_COLORS, coerceConnection } from "../../src/utils/connections";

describe("parseEnv", () => {
  it("keeps the three environments and nothing else", () => {
    for (const e of CONN_ENVS) expect(parseEnv(e)).toBe(e);
    for (const v of ["", "production", 1, null, undefined, {}]) expect(parseEnv(v)).toBeUndefined();
  });

  it("travels through the stored shape", () => {
    const base = { id: "a", name: "A", driver: "sqlite", params: {} };
    expect(coerceConnection({ ...base, env: "prod" })!.env).toBe("prod");
    expect(coerceConnection({ ...base, env: "staging" })!.env).toBeUndefined();
  });
});

describe("withEnv", () => {
  it("sets the default colour and protection", () => {
    expect(withEnv({}, "prod")).toEqual({ env: "prod", color: "#e5484d", safeMode: "confirm" });
    // Development clears a protection Production had set.
    expect(withEnv({ env: "prod", color: "#e5484d", safeMode: "confirm" }, "dev")).toEqual({
      env: "dev",
      color: "#4f7cf0",
      safeMode: undefined,
    });
  });

  it("leaves colour and protection alone when the environment is cleared", () => {
    expect(withEnv({ env: "test", color: "#123456", safeMode: "readOnly" }, undefined)).toEqual({
      env: undefined,
      color: "#123456",
      safeMode: "readOnly",
    });
  });

  it("picks its colours from the connection palette", () => {
    for (const e of CONN_ENVS) expect(CONNECTION_COLORS).toContain(ENV_DEFAULTS[e].color);
  });
});

describe("stripeColor", () => {
  it("is the connection's own colour first", () => {
    expect(stripeColor("#4bb45e", "readOnly")).toBe("#4bb45e");
  });

  it("never paints a protected connection without colour in the error red", () => {
    expect(stripeColor(undefined, "confirm")).toBe("var(--warn)");
    expect(stripeColor(undefined, "readOnly")).toBe("var(--text-dim)");
  });

  it("draws nothing for an unprotected connection without colour", () => {
    expect(stripeColor(undefined, undefined)).toBeUndefined();
    expect(stripeColor("", undefined)).toBeUndefined();
  });
});
