import { describe, it, expect } from "vitest";
import { stepStates } from "../../src/utils/wizard";

describe("stepStates", () => {
  it("marks the steps behind as done, one as current and the rest as waiting", () => {
    expect(stepStates(3, 0)).toEqual(["current", "todo", "todo"]);
    expect(stepStates(3, 1)).toEqual(["done", "current", "todo"]);
    expect(stepStates(3, 2)).toEqual(["done", "done", "current"]);
  });

  it("marks every step done past the last one (the result screen)", () => {
    expect(stepStates(2, 2)).toEqual(["done", "done"]);
  });

  it("has nothing to say about a wizard without steps", () => {
    expect(stepStates(0, 0)).toEqual([]);
  });
});
