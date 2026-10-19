import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { RunProgress } from "../../src/components/RunProgress";
import { WizardSummary } from "../../src/components/Wizard";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

function mount(node: () => any) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(node, host!);
  });
}

describe("RunProgress", () => {
  it("draws a determinate bar with done of total, percent and time left", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    mount(() => (
      <RunProgress
        title="Importando a clientes"
        done={2140}
        total={4812}
        unit="rows"
        startedAt={now - 6000}
        counts={[{ label: "2138 insertadas" }, { label: "2 con error", tone: "error" }]}
        note="Si cancelas, no se guarda ninguna fila."
      />
    ));
    const bar = host!.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("44");
    expect(bar.classList.contains("indeterminate")).toBe(false);
    expect(host!.querySelector(".run-progress-line")!.textContent).toBe("2140 de 4812 filas · 44 % · quedan unos 8 s");
    expect(host!.querySelector(".run-progress-counts")!.textContent).toContain("00:06 transcurrido");
    expect(host!.querySelector(".run-count.is-error")!.textContent).toBe("2 con error");
    expect(host!.textContent).toContain("Si cancelas");
  });

  it("is indeterminate while the total is unknown", () => {
    mount(() => <RunProgress title="Leyendo" done={300} total={null} unit="rows" startedAt={Date.now()} />);
    const bar = host!.querySelector('[role="progressbar"]')!;
    expect(bar.classList.contains("indeterminate")).toBe(true);
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(host!.querySelector(".run-progress-line")!.textContent).toBe("300 filas");
  });

  it("lists the errors so far and copies them", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount(() => (
      <RunProgress
        title="Importando"
        done={3}
        total={10}
        unit="rows"
        startedAt={Date.now()}
        errors={[
          { where: "Fila 318", message: "Ya existe" },
          { where: "Fila 1022", message: "Fecha no válida" },
        ]}
        errorPolicy="Si una fila falla: omitirla"
      />
    ));
    expect(host!.querySelector(".run-errors-head")!.textContent).toContain("Errores hasta ahora (2)");
    expect([...host!.querySelectorAll(".import-errors li")].map((l) => l.textContent)).toEqual([
      "Fila 318: Ya existe",
      "Fila 1022: Fecha no válida",
    ]);
    const copy = [...host!.querySelectorAll("button")].find((b) => b.textContent === "Copiar errores")!;
    copy.click();
    expect(writeText).toHaveBeenCalledWith("Fila 318\tYa existe\nFila 1022\tFecha no válida");
  });
});

describe("WizardSummary", () => {
  it("shows each figure with its label, failures marked", () => {
    mount(() => (
      <WizardSummary
        stats={[
          { value: 4810, label: "insertadas" },
          { value: 2, label: "con error", error: true },
        ]}
      />
    ));
    const stats = [...host!.querySelectorAll(".wiz-stat")];
    expect(stats.map((s) => s.textContent)).toEqual(["4810insertadas", "2con error"]);
    expect(stats[1].classList.contains("is-error")).toBe(true);
  });
});
