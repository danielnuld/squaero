import { describe, it, expect, afterEach, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Dropdown, type DropdownOption } from "../../src/components/Dropdown";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

const OPTIONS: DropdownOption[] = [
  { value: "", label: "Elige…" },
  { value: "apple", label: "Apple" },
  { value: "avocado", label: "Avocado", disabled: true },
  { value: "banana", label: "Banana" },
];

function mount(opts: { value?: string; disabled?: boolean; options?: DropdownOption[] } = {}) {
  const [value, setValue] = createSignal(opts.value ?? "");
  const onChange = vi.fn((v: string) => setValue(v));
  host = document.createElement("div");
  document.body.appendChild(host);
  // render()'s own disposer: it is what tears the portal'd list out of <body>.
  dispose = render(
    () => (
      <Dropdown
        value={value()}
        options={opts.options ?? OPTIONS}
        onChange={onChange}
        aria-label="Fruta"
        disabled={opts.disabled}
      />
    ),
    host,
  );
  const combo = host.querySelector<HTMLButtonElement>("[role=combobox]")!;
  return { combo, onChange, value };
}

const list = () => document.querySelector<HTMLElement>("[role=listbox]");
const options = () => Array.from(document.querySelectorAll<HTMLElement>("[role=option]"));
const active = (combo: HTMLElement) => {
  const id = combo.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.dataset.value : undefined;
};
const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));

describe("Dropdown as a control", () => {
  it("is a combobox button that shows the current option and its value", () => {
    const { combo } = mount({ value: "apple" });
    expect(combo.tagName).toBe("BUTTON");
    expect(combo.getAttribute("aria-haspopup")).toBe("listbox");
    expect(combo.getAttribute("aria-expanded")).toBe("false");
    expect(combo.getAttribute("aria-label")).toBe("Fruta");
    expect(combo.textContent).toBe("Apple");
    expect(combo.dataset.value).toBe("apple");
    expect(list()).toBeNull();
  });

  it("shows the placeholder styling when the value matches no option", () => {
    const { combo } = mount({ value: "nope", options: OPTIONS.slice(1) });
    expect(combo.querySelector(".dropdown-text")!.classList.contains("placeholder")).toBe(true);
  });

  it("does not open when disabled", () => {
    const { combo } = mount({ disabled: true });
    combo.click();
    key(combo, "ArrowDown");
    expect(list()).toBeNull();
  });
});

describe("Dropdown with the mouse", () => {
  it("opens on click, lists every option, marks the selected one and picks on click", () => {
    const { combo, onChange } = mount({ value: "apple" });
    combo.click();
    expect(combo.getAttribute("aria-expanded")).toBe("true");
    expect(combo.getAttribute("aria-controls")).toBe(list()!.id);
    expect(options().map((o) => o.textContent)).toEqual(["Elige…", "Apple", "Avocado", "Banana"]);
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    expect(options()[2].getAttribute("aria-disabled")).toBe("true");
    options()[3].click();
    expect(onChange).toHaveBeenCalledWith("banana");
    expect(list()).toBeNull();
    expect(combo.textContent).toBe("Banana");
  });

  it("does not pick a disabled option, nor report an unchanged value", () => {
    const { combo, onChange } = mount({ value: "apple" });
    combo.click();
    options()[2].click();
    expect(onChange).not.toHaveBeenCalled();
    expect(list()).not.toBeNull();
    options()[1].click();
    expect(onChange).not.toHaveBeenCalled();
    expect(list()).toBeNull();
  });

  it("closes on a second click and on a mousedown elsewhere", () => {
    const { combo } = mount();
    combo.click();
    combo.click();
    expect(list()).toBeNull();
    combo.click();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(list()).toBeNull();
  });
});

describe("Dropdown with the keyboard", () => {
  it("opens on ArrowDown with the selected option active, walks the list skipping disabled, and chooses on Enter", () => {
    const { combo, onChange } = mount({ value: "apple" });
    key(combo, "ArrowDown");
    expect(list()).not.toBeNull();
    expect(active(combo)).toBe("apple");
    key(combo, "ArrowDown");
    expect(active(combo)).toBe("banana");
    key(combo, "ArrowDown");
    expect(active(combo)).toBe("");
    key(combo, "ArrowUp");
    expect(active(combo)).toBe("banana");
    key(combo, "Enter");
    expect(onChange).toHaveBeenCalledWith("banana");
    expect(list()).toBeNull();
  });

  it("jumps with Home and End, and Space chooses too", () => {
    const { combo, onChange } = mount({ value: "apple" });
    key(combo, " ");
    key(combo, "End");
    expect(active(combo)).toBe("banana");
    key(combo, "Home");
    expect(active(combo)).toBe("");
    key(combo, " ");
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("Escape closes without changing anything", () => {
    const { combo, onChange } = mount({ value: "apple" });
    key(combo, "ArrowDown");
    key(combo, "ArrowDown");
    key(combo, "Escape");
    expect(list()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(combo.getAttribute("aria-expanded")).toBe("false");
  });

  it("Tab chooses the active option and lets focus move on", () => {
    const { combo, onChange } = mount({ value: "apple" });
    key(combo, "ArrowDown");
    key(combo, "ArrowDown");
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    combo.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onChange).toHaveBeenCalledWith("banana");
  });

  it("types ahead while open, and picks directly while closed", () => {
    vi.useFakeTimers();
    const { combo, onChange } = mount({ value: "" });
    key(combo, "ArrowDown");
    key(combo, "b");
    expect(active(combo)).toBe("banana");
    key(combo, "a"); // "ba" still means Banana
    expect(active(combo)).toBe("banana");
    vi.advanceTimersByTime(600); // the buffer resets
    key(combo, "a");
    expect(active(combo)).toBe("apple");
    key(combo, "Escape");
    vi.advanceTimersByTime(600);
    key(combo, "b");
    expect(onChange).toHaveBeenCalledWith("banana");
    expect(list()).toBeNull();
  });

  it("leaves chords such as Ctrl+Enter to the surrounding panel", () => {
    const { combo } = mount();
    const ev = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true });
    combo.dispatchEvent(ev);
    expect(list()).toBeNull();
    expect(ev.defaultPrevented).toBe(false);
  });
});
