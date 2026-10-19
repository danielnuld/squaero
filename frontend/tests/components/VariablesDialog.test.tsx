import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { VariablesDialog } from "../../src/components/VariablesDialog";
import type { SqlVariable } from "../../src/utils/sqlVariables";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const VARS = [
  { token: "${tabla}", kind: "raw" },
  { token: ":ciudad", kind: "value" },
] as unknown as SqlVariable[];

function mount(onRun = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <VariablesDialog variables={VARS} values={{}} onRun={onRun} onCancel={() => {}} />, host!);
  });
  return onRun;
}

const run = () =>
  [...host!.querySelectorAll<HTMLButtonElement>(".dlg-actions button")].find((b) => b.textContent === "Ejecutar")!;
const type = (id: string, value: string) => {
  const input = host!.querySelector<HTMLInputElement>(`[id="${id}"]`)!;
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  return input;
};

describe("VariablesDialog (audit A-35)", () => {
  it("keeps Run pressable and says which value is missing, next to its box", () => {
    const onRun = mount();
    expect(run().disabled).toBe(false);
    type("var-${tabla}", "clientes");
    run().click();
    expect(onRun).not.toHaveBeenCalled();
    expect(host!.textContent).toContain("Falta un valor para :ciudad");
    expect(document.activeElement).toBe(host!.querySelector('[id="var-:ciudad"]'));
  });

  it("runs with Enter from a box once every value is there", () => {
    const onRun = mount();
    type("var-${tabla}", "clientes");
    const city = type("var-:ciudad", "Nogales");
    city.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onRun).toHaveBeenCalledWith({
      "${tabla}": { text: "clientes" },
      ":ciudad": { text: "Nogales" },
    });
  });
});
