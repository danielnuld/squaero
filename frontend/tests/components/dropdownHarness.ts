// Drives the app's own <select> (components/Dropdown.tsx) from a test the way a
// user would: open the combobox, click an option. The button publishes its value
// as `data-value`, which is what `dropdownValue` reads.

const list = (combo: Element): HTMLElement => {
  const id = combo.getAttribute("aria-controls");
  const el = id ? document.getElementById(id) : null;
  if (!el) throw new Error("dropdown list is not open");
  return el;
};

const options = (combo: Element): HTMLElement[] =>
  Array.from(list(combo).querySelectorAll<HTMLElement>("[role=option]"));

/** The current value of a Dropdown's combobox button. */
export const dropdownValue = (combo: Element): string => combo.getAttribute("data-value") ?? "";

/** Opens the Dropdown (a click on its button) if it is not open yet. */
export function openDropdown(combo: Element): void {
  if (combo.getAttribute("aria-expanded") !== "true") (combo as HTMLElement).click();
}

/** Picks the option with this value, as a mouse user would. */
export function pickOption(combo: Element, value: string): void {
  openDropdown(combo);
  const opt = options(combo).find((o) => o.dataset.value === value);
  if (!opt) throw new Error(`no option with value ${JSON.stringify(value)}`);
  opt.click();
}

/** The values of every option, opening and closing the list to read them. */
export function dropdownValues(combo: Element): string[] {
  openDropdown(combo);
  const out = options(combo).map((o) => o.dataset.value ?? "");
  (combo as HTMLElement).click();
  return out;
}

/** The labels of every option, opening and closing the list to read them. */
export function dropdownLabels(combo: Element): string[] {
  openDropdown(combo);
  const out = options(combo).map((o) => o.textContent ?? "");
  (combo as HTMLElement).click();
  return out;
}
