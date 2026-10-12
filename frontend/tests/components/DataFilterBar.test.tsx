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

const mount = (addRef?: (add: () => void) => void) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  let applied = 0;
  let added = 0;
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
          onAdd={() => added++}
          onRemove={() => {}}
          onSort={() => {}}
          onAddSort={() => {}}
          onRemoveSort={() => {}}
          onApply={() => applied++}
          onClear={() => {}}
          onToggleCollapsed={() => {}}
          onOpenSql={() => {}}
          addRef={addRef}
        />
      ),
      host!,
    );
  });
  return { applied: () => applied, added: () => added };
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

// Issue #462: the list is where the eye is once it is long, so it gets its own
// "+ condición", and Shift+Enter is the same reflex without the mouse.
describe("DataFilterBar adds a condition", () => {
  it("adds on Shift+Enter instead of applying", () => {
    const { applied, added } = mount();
    press(host!.querySelector("input[type=text]")!, { shiftKey: true });
    expect(added()).toBe(1);
    expect(applied()).toBe(0);
  });

  it("still applies on Ctrl+Shift+Enter", () => {
    const { applied, added } = mount();
    press(host!.querySelector("select")!, { ctrlKey: true, shiftKey: true });
    expect(applied()).toBe(1);
    expect(added()).toBe(0);
  });

  it("has a + at the end of the list, not only in the head", () => {
    const { added } = mount();
    const adders = Array.from(host!.querySelectorAll("button")).filter(
      (b) => b.textContent === "+ condición",
    );
    expect(adders).toHaveLength(2);
    (host!.querySelector(".filter-actions button") as HTMLButtonElement).click();
    expect(added()).toBe(1);
  });
});

describe("DataFilterBar addRef (#592)", () => {
  it("hands App an add that adds a condition and focuses its column", async () => {
    let add: (() => void) | undefined;
    const { added } = mount((fn) => (add = fn));
    add!();
    expect(added()).toBe(1);
    await Promise.resolve();
    expect(document.activeElement?.classList.contains("filter-col")).toBe(true);
  });
});

// Issue #646: the connector belongs to a pair of rows, not to the whole list.
describe("DataFilterBar join toggle", () => {
  it("flips only the next condition's connector", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const calls: [number, unknown][] = [];
    const state = {
      ...emptyFilter(),
      collapsed: false,
      conditions: [
        { column: "nombre", op: "=" as const, value: "a" },
        { column: "edad", op: "=" as const, value: "1" },
        { column: "edad", op: "=" as const, value: "2", join: "OR" as const },
      ],
    };
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <DataFilterBar
            state={state}
            columns={["nombre", "edad"]}
            dirty={false}
            onChange={(i, patch) => calls.push([i, patch])}
            onAdd={() => {}}
            onRemove={() => {}}
            onSort={() => {}}
            onAddSort={() => {}}
            onRemoveSort={() => {}}
            onApply={() => {}}
            onClear={() => {}}
            onToggleCollapsed={() => {}}
            onOpenSql={() => {}}
          />
        ),
        host!,
      );
    });
    const joins = host.querySelectorAll<HTMLButtonElement>("button.filter-join");
    expect(joins.length).toBe(2);
    joins[0].click();
    joins[1].click();
    expect(calls).toEqual([
      [1, { join: "OR" }],
      [2, { join: "AND" }],
    ]);
  });
});
