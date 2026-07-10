import { describe, it, expect, afterEach, vi } from "vitest";
import { call, cancelQuery, hasBridge } from "../../src/utils/transport";
import { isError } from "../../src/utils/ipc";

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<string>;
}

afterEach(() => {
  delete (globalThis as BridgeHost).quaeroRpc;
});

describe("transport", () => {
  describe("hasBridge", () => {
    it("is false without a bridge", () => {
      expect(hasBridge()).toBe(false);
    });

    it("is true when the bridge is present", () => {
      (globalThis as BridgeHost).quaeroRpc = async () => "{}";
      expect(hasBridge()).toBe(true);
    });
  });

  describe("call", () => {
    it("rejects when the bridge is unavailable", async () => {
      await expect(call("ping")).rejects.toThrow(/bridge unavailable/);
    });

    it("sends a request and returns the parsed response (webview returns an object)", async () => {
      // Mirrors real webview behavior: the bound function resolves with an
      // already-parsed object, not a JSON string.
      const rpc = vi.fn(async (raw: string) => {
        const req = JSON.parse(raw) as { id: number | string };
        return { jsonrpc: "2.0", id: req.id, result: { pong: true } };
      });
      (globalThis as BridgeHost).quaeroRpc = rpc;

      const response = await call("ping", { message: "hi" });

      expect(rpc).toHaveBeenCalledOnce();
      const sent = JSON.parse(rpc.mock.calls[0][0]) as {
        method: string;
        params: unknown;
      };
      expect(sent.method).toBe("ping");
      expect(sent.params).toEqual({ message: "hi" });
      expect(isError(response)).toBe(false);
      if (!isError(response)) {
        expect(response.result).toEqual({ pong: true });
      }
    });

    it("also accepts a raw JSON string from the bridge (fallback)", async () => {
      (globalThis as BridgeHost).quaeroRpc = async () =>
        '{"jsonrpc":"2.0","id":1,"result":{"pong":true}}';

      const response = await call("ping");
      expect(isError(response)).toBe(false);
      if (!isError(response)) {
        expect(response.result).toEqual({ pong: true });
      }
    });
  });

  describe("cancelQuery", () => {
    it("sends op.cancel with the connId and returns the canceled flag", async () => {
      const rpc = vi.fn(async (raw: string) => {
        const req = JSON.parse(raw) as { id: number | string };
        return { jsonrpc: "2.0", id: req.id, result: { canceled: true } };
      });
      (globalThis as BridgeHost).quaeroRpc = rpc;

      const canceled = await cancelQuery("c3");

      const sent = JSON.parse(rpc.mock.calls[0][0]) as {
        method: string;
        params: unknown;
      };
      expect(sent.method).toBe("op.cancel");
      expect(sent.params).toEqual({ connId: "c3" });
      expect(canceled).toBe(true);
    });

    it("returns false when nothing was canceled", async () => {
      (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
        const req = JSON.parse(raw) as { id: number | string };
        return { jsonrpc: "2.0", id: req.id, result: { canceled: false } };
      };
      expect(await cancelQuery("c1")).toBe(false);
    });

    it("returns false on an error response instead of throwing", async () => {
      (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
        const req = JSON.parse(raw) as { id: number | string };
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32602, message: "malformed connId" },
        };
      };
      expect(await cancelQuery("bad")).toBe(false);
    });
  });
});
