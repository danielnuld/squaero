import { For, Show, createMemo, createSignal } from "solid-js";
import { Panel } from "./Panel";
import { classifyType } from "../utils/format";
import {
  buildChartData,
  defaultColumns,
  seriesMax,
  niceMax,
  axisTicks,
  pieSlices,
  arcPath,
  type ChartType,
} from "../utils/chart";
import type { ResultSet } from "../utils/query";

// Result visualization (issue #149): render a loaded result as a bar / line / pie
// chart with inline SVG (no chart library). The user picks the label (x) column
// and one or more numeric value columns; the geometry is the pure helpers in
// utils/chart.ts. Colors are the validated categorical palette (themed CSS vars
// --chart-1..8), assigned in fixed order — see the dataviz method.
const W = 760;
const H = 380;
const M = { top: 16, right: 16, bottom: 52, left: 60 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const PALETTE_N = 8;
const seriesColor = (i: number) => `var(--chart-${(i % PALETTE_N) + 1})`;

export function ChartView(props: { result: ResultSet; onClose: () => void }) {
  const cols = () => props.result.columns;
  const numericCols = createMemo(() =>
    cols()
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => classifyType(c.type) === "number")
      .map(({ i }) => i),
  );

  const initial = defaultColumns(props.result);
  const [type, setType] = createSignal<ChartType>("bar");
  const [labelCol, setLabelCol] = createSignal(initial.labelCol);
  const [valueCols, setValueCols] = createSignal<number[]>(initial.valueCols);

  const toggleValue = (ci: number, on: boolean) =>
    setValueCols((cur) => (on ? [...cur, ci].sort((a, b) => a - b) : cur.filter((c) => c !== ci)));

  const data = createMemo(() => buildChartData(props.result, labelCol(), valueCols()));
  // Pie uses a single series (the first selected value column).
  const pieValues = createMemo(() => data().series[0]?.values ?? []);
  const yMax = createMemo(() => niceMax(seriesMax(data().series)));
  const hasData = () => data().labels.length > 0 && valueCols().length > 0;

  const xStep = () => (data().labels.length > 0 ? PLOT_W / data().labels.length : PLOT_W);
  const y = (v: number) => M.top + PLOT_H - (yMax() > 0 ? (v / yMax()) * PLOT_H : 0);

  return (
    <Panel title="Gráfico" class="chart-view" onClose={props.onClose}>
      <div class="sm-head">
        <h2>Gráfico</h2>
        <div class="sm-actions">
          <button class="edit-btn" onClick={props.onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <div class="chart-controls">
        <label>
          Tipo
          <select class="map-select" value={type()} onChange={(e) => setType(e.currentTarget.value as ChartType)}>
            <option value="bar">Barras</option>
            <option value="line">Líneas</option>
            <option value="pie">Pastel</option>
          </select>
        </label>
        <label>
          Eje (etiquetas)
          <select
            class="map-select"
            value={labelCol()}
            onChange={(e) => setLabelCol(Number(e.currentTarget.value))}
          >
            <For each={cols()}>{(c, i) => <option value={i()}>{c.name}</option>}</For>
          </select>
        </label>
        <div class="chart-values">
          <span class="chart-values-label">
            {type() === "pie" ? "Valor (1)" : "Valores"}
          </span>
          <Show
            when={numericCols().length > 0}
            fallback={<span class="chart-hint">Sin columnas numéricas.</span>}
          >
            <For each={numericCols()}>
              {(ci) => (
                <label class="chart-value-opt">
                  <input
                    type="checkbox"
                    checked={valueCols().includes(ci)}
                    onChange={(e) => toggleValue(ci, e.currentTarget.checked)}
                  />{" "}
                  {cols()[ci].name}
                </label>
              )}
            </For>
          </Show>
        </div>
      </div>

      <Show when={type() === "pie" && valueCols().length > 1}>
        <p class="chart-hint">El pastel usa solo la primera columna de valor seleccionada.</p>
      </Show>

      <Show
        when={hasData()}
        fallback={<p class="grid-empty">Elige una columna de etiquetas y al menos un valor numérico.</p>}
      >
        <div class="chart-canvas">
          <svg viewBox={`0 0 ${W} ${H}`} class="chart-svg" role="img" aria-label={`Gráfico de ${type()}`}>
            <Show when={type() !== "pie"}>
              {/* Y grid + ticks */}
              <For each={axisTicks(yMax())}>
                {(t) => (
                  <>
                    <line class="chart-grid" x1={M.left} y1={y(t)} x2={M.left + PLOT_W} y2={y(t)} />
                    <text class="chart-tick" x={M.left - 8} y={y(t) + 4} text-anchor="end">
                      {t}
                    </text>
                  </>
                )}
              </For>
              {/* Baseline */}
              <line class="chart-axis" x1={M.left} y1={y(0)} x2={M.left + PLOT_W} y2={y(0)} />
            </Show>

            {/* Bars */}
            <Show when={type() === "bar"}>
              <For each={data().labels}>
                {(_lab, li) => {
                  const n = () => data().series.length;
                  const band = () => xStep() * 0.8;
                  const bw = () => band() / Math.max(1, n());
                  const x0 = () => M.left + xStep() * li() + (xStep() - band()) / 2;
                  return (
                    <For each={data().series}>
                      {(s, si) => {
                        const v = () => s.values[li()] ?? 0;
                        const bx = () => x0() + bw() * si() + 1;
                        return (
                          <rect
                            class="chart-bar"
                            x={bx()}
                            y={y(v())}
                            width={Math.max(1, bw() - 2)}
                            height={Math.max(0, y(0) - y(v()))}
                            rx="2"
                            fill={seriesColor(si())}
                          >
                            <title>
                              {s.name} · {data().labels[li()]}: {v()}
                            </title>
                          </rect>
                        );
                      }}
                    </For>
                  );
                }}
              </For>
            </Show>

            {/* Lines */}
            <Show when={type() === "line"}>
              <For each={data().series}>
                {(s, si) => {
                  const pts = () =>
                    s.values
                      .map((v, i) => `${M.left + xStep() * (i + 0.5)},${y(v)}`)
                      .join(" ");
                  return (
                    <>
                      <polyline class="chart-line" points={pts()} fill="none" stroke={seriesColor(si())} />
                      <For each={s.values}>
                        {(v, i) => (
                          <circle
                            class="chart-dot"
                            cx={M.left + xStep() * (i() + 0.5)}
                            cy={y(v)}
                            r="4"
                            fill={seriesColor(si())}
                          >
                            <title>
                              {s.name} · {data().labels[i()]}: {v}
                            </title>
                          </circle>
                        )}
                      </For>
                    </>
                  );
                }}
              </For>
            </Show>

            {/* X labels (bar/line) */}
            <Show when={type() !== "pie"}>
              <For each={data().labels}>
                {(lab, li) => (
                  <text
                    class="chart-tick"
                    x={M.left + xStep() * (li() + 0.5)}
                    y={M.top + PLOT_H + 18}
                    text-anchor="middle"
                  >
                    {lab.length > 10 ? `${lab.slice(0, 9)}…` : lab}
                  </text>
                )}
              </For>
            </Show>

            {/* Pie */}
            <Show when={type() === "pie"}>
              <For each={pieSlices(pieValues())}>
                {(slice, i) => (
                  <path
                    class="chart-slice"
                    d={arcPath(M.left + PLOT_W / 2, M.top + PLOT_H / 2, Math.min(PLOT_W, PLOT_H) / 2 - 8, slice.start, slice.end)}
                    fill={seriesColor(i())}
                  >
                    <title>
                      {data().labels[i()]}: {pieValues()[i()]} ({Math.round(slice.frac * 100)}%)
                    </title>
                  </path>
                )}
              </For>
            </Show>
          </svg>

          {/* Legend: series for bar/line, labels for pie (identity is never color-alone). */}
          <ul class="chart-legend">
            <Show
              when={type() === "pie"}
              fallback={
                <For each={data().series}>
                  {(s, si) => (
                    <li>
                      <span class="chart-swatch" style={{ background: seriesColor(si()) }} />
                      {s.name}
                    </li>
                  )}
                </For>
              }
            >
              <For each={data().labels}>
                {(lab, li) => (
                  <li>
                    <span class="chart-swatch" style={{ background: seriesColor(li()) }} />
                    {lab}
                  </li>
                )}
              </For>
            </Show>
          </ul>
        </div>
      </Show>
    </Panel>
  );
}
