import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { RowErrorPolicy, Wizard, WizardField } from "../../src/components/Wizard";

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

const footer = () => [...host!.querySelectorAll(".wiz-foot button")].map((b) => b.textContent);

describe("Wizard", () => {
  it("numbers the steps and marks the current one", () => {
    mount(() => <Wizard title="Importar a clientes" steps={["Origen", "Columnas", "Importar"]} step={1} />);
    const steps = [...host!.querySelectorAll(".wiz-step")];
    expect(steps.map((s) => s.className)).toEqual(["wiz-step is-done", "wiz-step is-current", "wiz-step is-todo"]);
    expect(steps[1].getAttribute("aria-current")).toBe("step");
    expect(steps[2].textContent).toBe("3Importar");
    expect(host!.querySelector("h2")!.textContent).toBe("Importar a clientes");
  });

  it("reads [Atrás] … [primary] [Cancelar] on Windows", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    mount(() => (
      <Wizard
        title="t"
        steps={["a", "b"]}
        step={1}
        onBack={() => {}}
        primary={{ label: "Generar 10 filas", onClick: () => {} }}
        onCancel={() => {}}
      />
    ));
    expect(footer()).toEqual(["Atrás", "Generar 10 filas", "Cancelar"]);
  });

  it("puts Cancelar before the primary on macOS and Linux", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    mount(() => (
      <Wizard title="t" onBack={() => {}} primary={{ label: "Siguiente", onClick: () => {} }} onCancel={() => {}} />
    ));
    expect(footer()).toEqual(["Atrás", "Cancelar", "Siguiente"]);
  });

  it("wires each button, and the primary is red when it destroys", () => {
    const back = vi.fn();
    const go = vi.fn();
    const cancel = vi.fn();
    mount(() => (
      <Wizard title="t" onBack={back} primary={{ label: "Aplicar", onClick: go, danger: true }} onCancel={cancel} />
    ));
    const [b, p, c] = [...host!.querySelectorAll<HTMLButtonElement>(".wiz-foot button")];
    b.click();
    p.click();
    c.click();
    expect([back.mock.calls.length, go.mock.calls.length, cancel.mock.calls.length]).toEqual([1, 1, 1]);
    expect(p.classList.contains("btn-danger")).toBe(true);
  });

  it("disables the footer and names the work while busy", () => {
    mount(() => (
      <Wizard
        title="t"
        busy
        busyLabel="Importando…"
        onBack={() => {}}
        primary={{ label: "Importar", onClick: () => {} }}
        onCancel={() => {}}
      />
    ));
    const buttons = [...host!.querySelectorAll<HTMLButtonElement>(".wiz-foot button")];
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(footer()).toContain("Importando…");
  });

  it("shows an error as an alert above the form", () => {
    mount(() => <Wizard title="t" error="No se pudo leer el archivo" />);
    expect(host!.querySelector("[role=alert]")!.textContent).toBe("No se pudo leer el archivo");
  });
});

describe("WizardField", () => {
  it("names its control by the label and puts the help under it", () => {
    mount(() => (
      <WizardField label="Tabla destino" help="Sus columnas se leen al pulsar Siguiente.">
        <input id="tbl" />
      </WizardField>
    ));
    const input = host!.querySelector<HTMLInputElement>("#tbl")!;
    expect(input.closest("label")!.querySelector(".wiz-label")!.textContent).toBe("Tabla destino");
    expect(host!.querySelector(".help")!.textContent).toBe("Sus columnas se leen al pulsar Siguiente.");
  });
});

describe("RowErrorPolicy", () => {
  it("offers skip or abort under «Si una fila falla»", () => {
    const onChange = vi.fn();
    mount(() => <RowErrorPolicy name="p" value="skip" onChange={onChange} />);
    expect(host!.querySelector("[role=radiogroup]")!.getAttribute("aria-label")).toBe("Si una fila falla");
    const [skip, abort] = [...host!.querySelectorAll<HTMLInputElement>("input[type=radio]")];
    expect(skip.checked).toBe(true);
    abort.click();
    expect(onChange).toHaveBeenCalledWith("abort");
  });
});
