import { describe, it, expect } from "vitest";
import type { Connection } from "../../src/utils/connections";
import {
  groupOpenConns,
  canDropOn,
  moveOpenConn,
  neighborInGroup,
} from "../../src/utils/openConnOrder";

const saved = (id: string, group?: string): Connection =>
  ({ id, name: id, driver: "mysql", params: {}, group }) as Connection;

const SAVED = [saved("a"), saved("b", "Prod"), saved("c", "Dev"), saved("d", "Prod"), saved("e")];
const open = (...ids: string[]) => ids.map((defId) => ({ defId }));
const ids = (list: { defId: string }[]) => list.map((o) => o.defId);

describe("groupOpenConns", () => {
  it("puts the ungrouped first, then each group alphabetically, keeping the open order", () => {
    const g = groupOpenConns(open("d", "a", "c", "b", "e"), SAVED);
    expect(g.map((x) => [x.name, ids(x.conns)])).toEqual([
      [null, ["a", "e"]],
      ["Dev", ["c"]],
      ["Prod", ["d", "b"]],
    ]);
  });

  it("yields a single unnamed bucket when nothing is grouped", () => {
    const g = groupOpenConns(open("a", "e"), SAVED);
    expect(g).toEqual([{ name: null, conns: open("a", "e") }]);
  });

  it("treats a connection deleted while open as ungrouped", () => {
    expect(groupOpenConns(open("zz"), SAVED)).toEqual([{ name: null, conns: open("zz") }]);
  });

  it("is empty with nothing open", () => {
    expect(groupOpenConns([], SAVED)).toEqual([]);
  });
});

describe("moveOpenConn", () => {
  it("moves a section down onto another of its group, landing after it", () => {
    expect(ids(moveOpenConn(open("b", "a", "d"), SAVED, "b", "d"))).toEqual(["a", "d", "b"]);
  });

  it("moves a section up, landing before the one dropped on", () => {
    expect(ids(moveOpenConn(open("a", "e"), SAVED, "e", "a"))).toEqual(["e", "a"]);
  });

  it("refuses a drop into another group, on itself or with unknown ids", () => {
    const list = open("a", "b", "c");
    expect(ids(moveOpenConn(list, SAVED, "a", "b"))).toEqual(["a", "b", "c"]);
    expect(ids(moveOpenConn(list, SAVED, "b", "b"))).toEqual(["a", "b", "c"]);
    expect(ids(moveOpenConn(list, SAVED, "x", "a"))).toEqual(["a", "b", "c"]);
  });
});

describe("canDropOn / neighborInGroup", () => {
  const groups = groupOpenConns(open("a", "b", "d", "e"), SAVED);

  it("allows a drop only inside the same group", () => {
    expect(canDropOn(groups, "a", "e")).toBe(true);
    expect(canDropOn(groups, "b", "d")).toBe(true);
    expect(canDropOn(groups, "a", "b")).toBe(false);
    expect(canDropOn(groups, "a", "a")).toBe(false);
    expect(canDropOn(groups, "x", "a")).toBe(false);
  });

  it("steps to the neighbour inside the group, null at its edges", () => {
    expect(neighborInGroup(groups, "a", 1)).toBe("e");
    expect(neighborInGroup(groups, "e", 1)).toBeNull();
    expect(neighborInGroup(groups, "b", -1)).toBeNull();
    expect(neighborInGroup(groups, "b", 1)).toBe("d");
    expect(neighborInGroup(groups, "x", 1)).toBeNull();
  });
});
