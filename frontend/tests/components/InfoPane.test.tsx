import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { InfoPane } from "../../src/components/InfoPane";
import type { InfoInput } from "../../src/utils/infoPane";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const input: InfoInput = {
  loading: false,
  error: null,
  columns: 5,
  rows: 1280,
  truncated: true,
  elapsedMs: 42,
  source: { table: "clientes", db: "ventas", pk: ["id"] },
};

function mount(info: InfoInput = input) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <InfoPane info={info} />, host!);
  });
}

const toggle = () => host!.querySelector(".infopane-toggle") as HTMLButtonElement;

describe("InfoPane", () => {
  it("is collapsed by default, showing a one-line summary", () => {
    mount();
    expect(host!.querySelector(".infopane-body")).toBeNull();
    expect(host!.querySelector(".infopane-summary")!.textContent).toMatch(/1,?280 fila/);
  });

  it("expands to show General facts including the object + PK", () => {
    mount();
    toggle().click();
    const body = host!.querySelector(".infopane-body")!;
    expect(body.textContent).toContain("ventas.clientes");
    expect(body.textContent).toContain("Filas");
  });

  it("switches to the Mensajes tab and reflects an error", () => {
    mount({ ...input, error: "syntax error near FROM" });
    toggle().click();
    const msgTab = [...host!.querySelectorAll(".infopane-tab")].find((t) =>
      t.textContent === "Mensajes",
    ) as HTMLButtonElement;
    msgTab.click();
    const msg = host!.querySelector(".infopane-msg")!;
    expect(msg.classList.contains("kind-error")).toBe(true);
    expect(msg.textContent).toContain("syntax error");
  });
});
