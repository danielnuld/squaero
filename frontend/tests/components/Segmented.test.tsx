import { describe, it, expect, afterEach } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Segmented } from "../../src/components/Segmented";

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
});

const mount = (disabled: string[] = [], initial = "b") => {
  host = document.createElement("div");
  document.body.appendChild(host);
  const [value, setValue] = createSignal(initial);
  dispose = render(
    () => (
      <Segmented
        label="Vista"
        options={["a", "b", "c", "d"].map((v) => ({ value: v, label: v.toUpperCase(), disabled: disabled.includes(v) }))}
        value={value()}
        onChange={setValue}
      />
    ),
    host,
  );
  return { value, radios: () => [...host!.querySelectorAll<HTMLButtonElement>("[role=radio]")] };
};
const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("Segmented (R-29)", () => {
  it("is a named radio group whose checked option is the only Tab stop", () => {
    const { radios } = mount();
    const group = host!.querySelector("[role=radiogroup]")!;
    expect(group.getAttribute("aria-label")).toBe("Vista");
    expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false"]);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(radios()[1].classList.contains("on")).toBe(true);
  });

  it("moves the choice and the focus with the arrows, wrapping, and Home/End", () => {
    const { value, radios } = mount();
    radios()[1].focus();
    key(radios()[1], "ArrowRight");
    expect(value()).toBe("c");
    expect(document.activeElement).toBe(radios()[2]);
    expect(radios()[2].tabIndex).toBe(0);
    key(radios()[2], "ArrowDown");
    key(radios()[3], "ArrowRight");
    expect(value()).toBe("a");
    key(radios()[0], "ArrowLeft");
    expect(value()).toBe("d");
    key(radios()[3], "Home");
    expect(value()).toBe("a");
    key(radios()[0], "End");
    expect(value()).toBe("d");
    expect(document.activeElement).toBe(radios()[3]);
  });

  it("skips a disabled option", () => {
    const { value, radios } = mount(["c"]);
    key(radios()[1], "ArrowRight");
    expect(value()).toBe("d");
  });

  it("picks on click", () => {
    const { value, radios } = mount();
    radios()[0].click();
    expect(value()).toBe("a");
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");
  });

  it("puts the Tab stop on the first enabled option when none is checked", () => {
    const { radios } = mount(["a"], "zzz");
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
  });
});
