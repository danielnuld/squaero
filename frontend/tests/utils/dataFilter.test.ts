import { describe, it, expect } from "vitest";
import {
  applyFilter,
  cycleSortColumn,
  draftFilter,
  emptyFilter,
  filterIsDirty,
  filterIsEmpty,
  sameFilter,
  summaryParts,
  type FilterState,
} from "../../src/utils/dataFilter";
import type { Condition } from "../../src/utils/queryBuilder";

// Issue #347. The panel's own shape: what is drafted, what the rows on screen
// were actually fetched with, and whether those two have drifted apart.

const cond = (over: Partial<Condition> = {}): Condition => ({
  column: "IdUnidad",
  op: "=",
  value: "235",
  ...over,
});
const state = (over: Partial<FilterState> = {}): FilterState => ({
  ...emptyFilter(),
  ...over,
});

describe("draftFilter", () => {
  it("renders the conditions and the sort into the two clauses", () => {
    const f = draftFilter(
      "postgres",
      state({ conditions: [cond()], order: [{ column: "Fecha", dir: "DESC" }] }),
    );
    expect(f).toEqual({ where: `"IdUnidad" = '235'`, orderBy: `"Fecha" DESC` });
  });

  it("uses the declared types when it has them", () => {
    const f = draftFilter("postgres", state({ conditions: [cond()] }), { IdUnidad: "int" });
    expect(f.where).toBe(`"IdUnidad" = 235`);
  });

  it("is two empty strings for an empty panel", () => {
    expect(draftFilter("postgres", emptyFilter())).toEqual({ where: "", orderBy: "" });
  });
});

describe("filterIsDirty", () => {
  it("is dirty as soon as a condition is written but not applied", () => {
    expect(filterIsDirty("postgres", state({ conditions: [cond()] }))).toBe(true);
  });

  it("is clean right after applying", () => {
    const applied = applyFilter("postgres", state({ conditions: [cond()] }));
    expect(filterIsDirty("postgres", applied)).toBe(false);
  });

  it("goes dirty again when the draft changes after applying", () => {
    const applied = applyFilter("postgres", state({ conditions: [cond()] }));
    const edited = { ...applied, conditions: [cond({ value: "999" })] };
    expect(filterIsDirty("postgres", edited)).toBe(true);
  });

  it("is clean for an untouched panel, which has nothing to apply", () => {
    expect(filterIsDirty("postgres", emptyFilter())).toBe(false);
  });

  it("is clean when an edit renders to the same SQL", () => {
    // Turning off a condition that said nothing anyway must not claim the grid
    // is out of date: the note only earns attention if it is always true.
    const applied = applyFilter("postgres", state({ conditions: [cond()] }));
    const withBlank = {
      ...applied,
      conditions: [cond(), cond({ column: "", value: "" })],
    };
    expect(filterIsDirty("postgres", withBlank)).toBe(false);
  });

  it("counts a disabled condition as a change, because the rows change", () => {
    const applied = applyFilter("postgres", state({ conditions: [cond()] }));
    const off = { ...applied, conditions: [cond({ enabled: false })] };
    expect(filterIsDirty("postgres", off)).toBe(true);
  });
});

describe("sameFilter / filterIsEmpty", () => {
  it("treats undefined and empty as the same absence", () => {
    expect(sameFilter(null, { where: "", orderBy: "" })).toBe(true);
    expect(sameFilter({ where: "a = 1" }, { where: "a = 1", orderBy: "" })).toBe(true);
    expect(sameFilter({ where: "a = 1" }, { where: "a = 2" })).toBe(false);
  });

  it("knows when nothing is being filtered or sorted", () => {
    expect(filterIsEmpty(null)).toBe(true);
    expect(filterIsEmpty({ where: "", orderBy: "" })).toBe(true);
    expect(filterIsEmpty({ orderBy: "a ASC" })).toBe(false);
  });
});

describe("cycleSortColumn", () => {
  it("cycles ascending, descending, off", () => {
    let order = cycleSortColumn([], "Fecha");
    expect(order).toEqual([{ column: "Fecha", dir: "ASC" }]);
    order = cycleSortColumn(order, "Fecha");
    expect(order).toEqual([{ column: "Fecha", dir: "DESC" }]);
    expect(cycleSortColumn(order, "Fecha")).toEqual([]);
  });

  it("starts over on a different column instead of adding to it", () => {
    // Clicking a header means "sort by this". Keeping the previous column would
    // make the order on screen impossible to explain from the header alone.
    const order = cycleSortColumn([{ column: "Fecha", dir: "DESC" }], "IdUnidad");
    expect(order).toEqual([{ column: "IdUnidad", dir: "ASC" }]);
  });

  it("starts over when several columns were sorted from the panel", () => {
    const many = [
      { column: "Fecha", dir: "ASC" as const },
      { column: "IdUnidad", dir: "ASC" as const },
    ];
    expect(cycleSortColumn(many, "Fecha")).toEqual([{ column: "Fecha", dir: "ASC" }]);
  });
});

// Issue #386: the folded bar's one line. It has to count what the SQL will
// actually carry — a half-typed row promising a filter the grid does not have
// is worse than no summary at all.
describe("summaryParts", () => {
  it("counts nothing for a fresh filter", () => {
    expect(summaryParts(emptyFilter())).toEqual({ conditions: 0, order: 0 });
  });

  it("skips a condition with no column and one switched off", () => {
    const s = state({
      conditions: [cond(), cond({ column: "" }), cond({ enabled: false })],
      order: [{ column: "Fecha", dir: "DESC" }, { column: "", dir: "ASC" }],
    });
    expect(summaryParts(s)).toEqual({ conditions: 1, order: 1 });
  });
});

it("opens folded, so a table tab starts on its rows", () => {
  expect(emptyFilter().collapsed).toBe(true);
});
