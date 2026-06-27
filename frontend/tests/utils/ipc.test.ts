import { describe, it, expect } from "vitest";
import {
  buildRequest,
  isError,
  nextId,
  parseResponse,
} from "../../src/utils/ipc";

describe("ipc", () => {
  describe("buildRequest", () => {
    it("builds a minimal JSON-RPC request", () => {
      expect(buildRequest(1, "ping")).toEqual({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      });
    });

    it("includes params when provided", () => {
      expect(buildRequest("a", "ping", { message: "hi" })).toEqual({
        jsonrpc: "2.0",
        id: "a",
        method: "ping",
        params: { message: "hi" },
      });
    });

    it("omits params when undefined", () => {
      expect(buildRequest(1, "app.hello")).not.toHaveProperty("params");
    });
  });

  describe("nextId", () => {
    it("increments on each call", () => {
      const a = nextId();
      const b = nextId();
      expect(b).toBe(a + 1);
    });
  });

  describe("parseResponse / isError", () => {
    it("detects a success response", () => {
      const r = parseResponse(
        '{"jsonrpc":"2.0","id":1,"result":{"pong":true}}',
      );
      expect(isError(r)).toBe(false);
      if (!isError(r)) {
        expect(r.result).toEqual({ pong: true });
      }
    });

    it("detects an error response", () => {
      const r = parseResponse(
        '{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"x"}}',
      );
      expect(isError(r)).toBe(true);
      if (isError(r)) {
        expect(r.error.code).toBe(-32601);
      }
    });
  });
});
