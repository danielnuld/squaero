import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { StatusBar } from "../../src/components/StatusBar";

// Issue #386: the bar absorbed the pager band and the information pane, so the
// facts they carried have to actually arrive here.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const base = {
  connection: "Ventas (demo)",
  rowCount: 26,
  truncated: false,
  elapsedMs: 11,
  theme: "dark" as const,
  onToggleTheme: () => {},
  onShowHelp: () => {},
  onShowSettings: () => {},
};

type Props = Parameters<typeof StatusBar>[0];

function mount(over: Partial<Props> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <StatusBar {...base} {...over} />, host!);
  });
  return host;
}

describe("StatusBar", () => {
  it("names the connection, the object and the shape of the result", () => {
    mount({ object: "ventas.clientes", columnCount: 7 });
    const text = host!.textContent ?? "";
    expect(text).toContain("Ventas (demo)");
    expect(text).toContain("ventas.clientes");
    expect(text).toContain("26 filas");
    expect(text).toContain("7 columnas");
  });

  it("shows no pager for a result that was not paged", () => {
    mount({ object: null });
    expect(host!.querySelector(".status-page")).toBeNull();
  });

  it("pages back and forward, and holds still while editing", () => {
    const steps: number[] = [];
    mount({
      page: { from: 51, to: 100, canPrev: true, canNext: false, paused: false },
      onPage: (d: -1 | 1) => steps.push(d),
    });
    const [prev, next] = [
      ...host!.querySelectorAll(".status-page button"),
    ] as HTMLButtonElement[];
    expect(host!.textContent).toContain("Filas 51–100");
    expect(next.disabled).toBe(true);
    prev.click();
    next.click();
    expect(steps).toEqual([-1]);
  });
});
