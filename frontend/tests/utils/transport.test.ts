import { describe, it, expect, afterEach, vi } from "vitest";
import { call, hasBridge } from "../../src/utils/transport";
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

    it("sends a request and parses the response", async () => {
      const rpc = vi.fn(async (raw: string) => {
        const req = JSON.parse(raw) as { id: number | string };
        return JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { pong: true },
        });
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
  });
});
