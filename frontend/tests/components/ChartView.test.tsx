import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ChartView } from "../../src/components/ChartView";
import type { ResultSet } from "../../src/utils/query";

// Drives the real ChartView in jsdom: it picks default columns, renders bars, and
// switches chart type + value columns to re-render as lines / pie.

const result: ResultSet = {
  columns: [
    { name: "month", type: "text" },
    { name: "sales", type: "int" },
    { name: "cost", type: "float" },
  ],
  rows: [
    ["Jan", "100", "40"],
    ["Feb", "150", "55"],
    ["Mar", "120", "60"],
  ],
  truncated: false,
  rowsAffected: 0,
};

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(r: ResultSet = result) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <ChartView result={r} onClose={() => {}} />, host!);
  });
  return host!;
}

const setType = (v: string) => {
  const sel = host!.querySelector<HTMLSelectElement>(".chart-controls select")!;
  sel.value = v;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("ChartView", () => {
  it("defaults to a bar chart over the first text label + first numeric value", () => {
    const el = mount();
    // Label select = month (index 0); one value column checked (sales).
    const checked = [...el.querySelectorAll<HTMLInputElement>(".chart-value-opt input")].filter(
      (c) => c.checked,
    );
    expect(checked.length).toBe(1);
    // 3 labels x 1 series = 3 bars.
    expect(el.querySelectorAll(".chart-bar").length).toBe(3);
    // Legend names the series.
    expect(el.querySelector(".chart-legend")?.textContent).toContain("sales");
  });

  it("adds a second series and draws grouped bars", () => {
    const el = mount();
    const cost = [...el.querySelectorAll<HTMLLabelElement>(".chart-value-opt")].find((l) =>
      l.textContent?.includes("cost"),
    )!;
    cost.querySelector("input")!.click();
    // 3 labels x 2 series = 6 bars.
    expect(el.querySelectorAll(".chart-bar").length).toBe(6);
    expect(el.querySelector(".chart-legend")?.textContent).toContain("cost");
  });

  it("switches to a line chart (polyline + dots)", () => {
    const el = mount();
    setType("line");
    expect(el.querySelectorAll(".chart-bar").length).toBe(0);
    expect(el.querySelectorAll(".chart-line").length).toBe(1);
    expect(el.querySelectorAll(".chart-dot").length).toBe(3);
  });

  it("switches to a pie chart (one slice per label)", () => {
    const el = mount();
    setType("pie");
    expect(el.querySelectorAll(".chart-slice").length).toBe(3);
    // Pie legend lists the labels.
    expect(el.querySelector(".chart-legend")?.textContent).toContain("Jan");
  });

  it("shows an empty state when no value column is selected", () => {
    const el = mount();
    const box = el.querySelector<HTMLInputElement>(".chart-value-opt input")!;
    box.click(); // uncheck the only selected value
    expect(el.querySelector(".chart-svg")).toBeNull();
    expect(el.textContent).toContain("al menos un valor");
  });
});
