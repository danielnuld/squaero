import { describe, it, expect } from "vitest";
import {
  keepAliveDelaySec,
  keepAliveDue,
  keepAliveProbe,
  lostInfo,
  mayReconnect,
  mayRetry,
  normalizeKeepAlive,
  notRetried,
  NOT_RETRIED_KEY,
} from "../../src/utils/reconnect";
import { en } from "../../src/utils/messages/en";
import { es } from "../../src/utils/messages/es";

describe("lostInfo", () => {
  it("reads the core's lost-connection data", () => {
    expect(lostInfo({ connLost: true, inTx: false, retrySafe: true })).toEqual({
      inTx: false,
      retrySafe: true,
    });
    expect(lostInfo({ connLost: true, inTx: true, retrySafe: false })).toEqual({
      inTx: true,
      retrySafe: false,
    });
  });

  it("missing flags read as the unsafe value", () => {
    expect(lostInfo({ connLost: true })).toEqual({ inTx: false, retrySafe: false });
    expect(lostInfo({ connLost: true, retrySafe: "yes" })?.retrySafe).toBe(false);
  });

  it("is null for an older core, or data that is not about a lost session", () => {
    expect(lostInfo(undefined)).toBeNull();
    expect(lostInfo(null)).toBeNull();
    expect(lostInfo("gone")).toBeNull();
    expect(lostInfo({ inTx: false, retrySafe: true })).toBeNull();
  });
});

describe("mayReconnect", () => {
  const free = { inTx: false, retrySafe: false };
  it("reconnects when no transaction dies with the session", () => {
    expect(mayReconnect(free, false)).toBe(true);
  });
  it("never inside a transaction the core tracks", () => {
    expect(mayReconnect({ inTx: true, retrySafe: false }, false)).toBe(false);
  });
  it("never inside one only the editor knows of (BEGIN with options)", () => {
    expect(mayReconnect(free, true)).toBe(false);
  });
  it("not for an older core that says nothing (the #407 banner)", () => {
    expect(mayReconnect(null, false)).toBe(false);
  });
});

describe("mayRetry", () => {
  const safe = { inTx: false, retrySafe: true };
  it("retries a safe call once a new session is up", () => {
    expect(mayRetry(safe, true, false)).toBe(true);
  });
  it("not without a new session", () => {
    expect(mayRetry(safe, false, false)).toBe(false);
  });
  it("not twice", () => {
    expect(mayRetry(safe, true, true)).toBe(false);
  });
  it("not what the core did not prove safe, nor without its word", () => {
    expect(mayRetry({ inTx: false, retrySafe: false }, true, false)).toBe(false);
    expect(mayRetry(null, true, false)).toBe(false);
  });
});

describe("notRetried", () => {
  it("names the transaction first", () => {
    expect(notRetried(true, false)).toBe("tx");
    expect(notRetried(true, true)).toBe("tx");
  });
  it("tells a restored session from one that is still down", () => {
    expect(notRetried(false, true)).toBe("unsafe");
    expect(notRetried(false, false)).toBe("down");
  });
  it("every reason has its message in both languages", () => {
    for (const key of Object.values(NOT_RETRIED_KEY)) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
    }
  });
});

describe("keepAliveProbe", () => {
  it("is a trivial read on the network engines", () => {
    expect(keepAliveProbe("postgres")).toBe("SELECT 1");
    expect(keepAliveProbe("postgresql")).toBe("SELECT 1");
    expect(keepAliveProbe("mysql")).toBe("SELECT 1");
    expect(keepAliveProbe("mariadb")).toBe("SELECT 1");
    expect(keepAliveProbe("mssql")).toBe("SELECT 1");
    // Informix has no FROM-less SELECT.
    expect(keepAliveProbe("informix")).toBe("SELECT 1 FROM systables WHERE tabid = 1");
  });
  it("does not apply to SQLite, MongoDB or an unknown engine", () => {
    expect(keepAliveProbe("sqlite")).toBeNull();
    expect(keepAliveProbe("mongodb")).toBeNull();
    expect(keepAliveProbe("oracle")).toBeNull();
    expect(keepAliveProbe("")).toBeNull();
  });
});

describe("keepAliveDelaySec", () => {
  it("is the interval while probes succeed", () => {
    expect(keepAliveDelaySec(60, 0)).toBe(60);
  });
  it("doubles per consecutive failure, up to 10 minutes", () => {
    expect(keepAliveDelaySec(60, 1)).toBe(120);
    expect(keepAliveDelaySec(60, 3)).toBe(480);
    expect(keepAliveDelaySec(60, 4)).toBe(600);
    expect(keepAliveDelaySec(60, 1000)).toBe(600);
  });
  it("never waits less than the interval itself", () => {
    expect(keepAliveDelaySec(900, 5)).toBe(900);
  });
  it("treats a negative failure count as none", () => {
    expect(keepAliveDelaySec(30, -2)).toBe(30);
  });
});

describe("keepAliveDue", () => {
  const idleSince = (last: number) => ({ inFlight: 0, last });
  it("probes a connection quiet for the interval", () => {
    expect(keepAliveDue(60_000, 60, idleSince(0), 0)).toBe(true);
    expect(keepAliveDue(59_999, 60, idleSince(0), 0)).toBe(false);
  });
  it("never while a call is in flight on it", () => {
    expect(keepAliveDue(1e9, 60, { inFlight: 1, last: 0 }, 0)).toBe(false);
  });
  it("is off at 0, a negative or a non-number interval", () => {
    expect(keepAliveDue(1e9, 0, idleSince(0), 0)).toBe(false);
    expect(keepAliveDue(1e9, -5, idleSince(0), 0)).toBe(false);
    expect(keepAliveDue(1e9, Number.NaN, idleSince(0), 0)).toBe(false);
  });
  it("waits longer after failures", () => {
    expect(keepAliveDue(60_000, 60, idleSince(0), 1)).toBe(false);
    expect(keepAliveDue(120_000, 60, idleSince(0), 1)).toBe(true);
  });
});

describe("normalizeKeepAlive", () => {
  it("keeps whole positive seconds", () => {
    expect(normalizeKeepAlive(30)).toBe(30);
    expect(normalizeKeepAlive("45")).toBe(45);
    expect(normalizeKeepAlive(90.7)).toBe(90);
  });
  it("anything else is off", () => {
    expect(normalizeKeepAlive(0)).toBeUndefined();
    expect(normalizeKeepAlive("")).toBeUndefined();
    expect(normalizeKeepAlive("abc")).toBeUndefined();
    expect(normalizeKeepAlive(-10)).toBeUndefined();
    expect(normalizeKeepAlive(0.5)).toBeUndefined();
    expect(normalizeKeepAlive(Infinity)).toBeUndefined();
    expect(normalizeKeepAlive(null)).toBeUndefined();
    expect(normalizeKeepAlive(undefined)).toBeUndefined();
  });
});
