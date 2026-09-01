import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { DataFilterBar } from "../../src/components/DataFilterBar";
import { emptyFilter } from "../../src/utils/dataFilter";

// Enter applies the draft filter (a "picar el botoncito de Aplicar" was the only
// way to run it before), while leaving a plain Enter on a button to that button.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  let applied = 0;
  const state = {
    ...emptyFilter(),
    collapsed: false,
    conditions: [{ column: "nombre", op: "CONTAINS" as const, value: "ana" }],
  };
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <DataFilterBar
          state={state}
          columns={["nombre", "edad"]}
          dirty={true}
          onChange={() => {}}
          onAdd={() => {}}
          onRemove={() => {}}
          onConjunction={() => {}}
          onSort={() => {}}
          onAddSort={() => {}}
          onRemoveSort={() => {}}
          onApply={() => applied++}
          onClear={() => {}}
          onToggleCollapsed={() => {}}
          onOpenSql={() => {}}
        />
      ),
      host!,
    );
  });
  return { applied: () => applied };
};

const press = (el: Element, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init }));

describe("DataFilterBar Enter applies", () => {
  it("applies on Enter from a value input", () => {
    const { applied } = mount();
    const input = host!.querySelector("input[type=text]") ?? host!.querySelector("input")!;
    press(input);
    expect(applied()).toBe(1);
  });

  it("applies on Ctrl+Enter", () => {
    const { applied } = mount();
    press(host!.querySelector("select")!, { ctrlKey: true });
    expect(applied()).toBe(1);
  });

  it("leaves a plain Enter on a button to that button", () => {
    const { applied } = mount();
    press(host!.querySelector("button")!);
    expect(applied()).toBe(0);
  });

  it("ignores other keys", () => {
    const { applied } = mount();
    press(host!.querySelector("select")!, { key: "a" });
    expect(applied()).toBe(0);
  });
});
