import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RunStatus } from "../../src/components/RunStatus";
import type { ResultSet } from "../../src/utils/query";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

const rows = (n: number): ResultSet =>
  ({
    columns: [{ name: "a", type: "integer" }],
    rows: Array.from({ length: n }, (_, i) => [i]),
    rowsAffected: 0,
  }) as unknown as ResultSet;
const write = (n: number): ResultSet => ({ columns: [], rows: [], rowsAffected: n }) as unknown as ResultSet;

type Props = Parameters<typeof RunStatus>[0];
function mount(over: Partial<Props> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const props: Props = { loading: false, result: null, error: null, elapsedMs: null, ...over };
  createRoot((d) => {
    dispose = d;
    render(() => <RunStatus {...props} />, host!);
  });
}
const text = () => host!.querySelector(".run-status-text")?.textContent;
const buttons = () => [...host!.querySelectorAll("button")];

describe("RunStatus", () => {
  it("shows nothing before the first run", () => {
    mount();
    expect(host!.querySelector(".run-status")).toBeNull();
  });

  it("sums up a result set", () => {
    mount({ result: rows(8), elapsedMs: 11 });
    expect(text()).toBe("Resultado · 8 filas · 11 ms");
    mount({ result: rows(1), elapsedMs: 3 });
    expect(text()).toBe("Resultado · 1 fila · 3 ms");
  });

  it("sums up a write by the rows it touched", () => {
    mount({ result: write(2), elapsedMs: 9 });
    expect(text()).toBe("2 filas afectadas · 9 ms");
    expect(host!.querySelector(".run-status")!.getAttribute("role")).toBe("status");
  });

  it("ticks a clock while running, with the statement of a script, and cancels", () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    const started = Date.now();
    mount({ loading: true, startedAt: started, progress: { n: 2, total: 3 }, onCancel });
    expect(text()).toBe("Ejecutando · 00:00 · sentencia 2 de 3");
    vi.advanceTimersByTime(4000);
    expect(text()).toBe("Ejecutando · 00:04 · sentencia 2 de 3");
    const cancel = buttons().find((b) => b.textContent === "Cancelar")!;
    cancel.click();
    expect(onCancel).toHaveBeenCalled();
  });

  it("leaves the statement count out for a single statement", () => {
    mount({ loading: true, startedAt: Date.now(), progress: { n: 1, total: 1 } });
    expect(text()).toBe("Ejecutando · 00:00");
  });

  it("disables Cancelar with the reason when the engine cannot cancel", () => {
    mount({ loading: true, startedAt: Date.now(), onCancel: () => {}, cancelBlocked: "No se puede cancelar" });
    const cancel = buttons()[0];
    expect(cancel.disabled).toBe(true);
    expect(cancel.title).toBe("No se puede cancelar");
  });

  it("names the failed line and links to it", () => {
    const onReveal = vi.fn();
    mount({ error: "no such column", elapsedMs: 13, errorLine: 3, onReveal });
    expect(text()).toBe("Error en la línea 3 · 13 ms");
    expect(host!.querySelector(".run-status")!.classList.contains("is-error")).toBe(true);
    buttons().find((b) => b.textContent === "Ir a la línea 3")!.click();
    expect(onReveal).toHaveBeenCalled();
  });

  it("without a named line, links to the statement; without a place, offers no link", () => {
    mount({ error: "boom", elapsedMs: 1, onReveal: () => {} });
    expect(text()).toBe("Error · 1 ms");
    expect(buttons().map((b) => b.textContent)).toEqual(["Ir a la sentencia"]);
    mount({ error: "boom", elapsedMs: 1 });
    expect(host!.querySelectorAll("button")).toHaveLength(0);
  });

  it("stops the clock when the run ends", () => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    const [loading, setLoading] = createSignal(true);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <RunStatus
            loading={loading()}
            startedAt={Date.now()}
            result={loading() ? null : rows(2)}
            error={null}
            elapsedMs={loading() ? null : 1500}
          />
        ),
        host!,
      );
    });
    vi.advanceTimersByTime(1000);
    setLoading(false);
    expect(text()).toBe("Resultado · 2 filas · 1.5 s");
    expect(vi.getTimerCount()).toBe(0);
  });
});
