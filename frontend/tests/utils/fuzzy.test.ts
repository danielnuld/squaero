import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "../../src/utils/fuzzy";

describe("fuzzyMatch", () => {
  it("matches an empty query against anything with score 0", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ matched: true, score: 0 });
    expect(fuzzyMatch("   ", "anything")).toEqual({ matched: true, score: 0 });
  });

  it("matches an ordered subsequence, case-insensitively", () => {
    expect(fuzzyMatch("usmon", "Usuarios y monitor").matched).toBe(true);
    expect(fuzzyMatch("ORD", "orders").matched).toBe(true);
  });

  it("rejects when chars are out of order or missing", () => {
    expect(fuzzyMatch("nom", "monitor").matched).toBe(false); // 'n' after 'o' impossible
    expect(fuzzyMatch("xyz", "orders").matched).toBe(false);
  });

  it("scores a word-start / prefix match above a scattered one", () => {
    const prefix = fuzzyMatch("ord", "orders");
    const scattered = fuzzyMatch("ord", "for dinner rows"); // o..r..d across words
    expect(prefix.matched && scattered.matched).toBe(true);
    expect(prefix.score).toBeGreaterThan(scattered.score);
  });

  it("rewards contiguous runs over gapped matches", () => {
    const contiguous = fuzzyMatch("cust", "customers");
    const gapped = fuzzyMatch("cust", "c_u_s_t_x");
    expect(contiguous.score).toBeGreaterThan(gapped.score);
  });
});
