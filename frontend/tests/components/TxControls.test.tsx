import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { TxControls } from "../../src/components/TxControls";
import type { TxSession } from "../../src/utils/txMode";

// The Auto | Manual segmented switch (issue #691, TxControlsMenu): a radio group
// over the connection's transaction mode.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const session = (over: Partial<TxSession> = {}): TxSession =>
  ({ manual: false, open: false, statements: 0, ...over }) as TxSession;

function mount(initial: TxSession, unsupportedReason: string | null = null) {
  const [s, setS] = createSignal(initial);
  const onToggle = vi.fn(() => setS((x) => ({ ...x, manual: !x.manual })));
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <TxControls
        session={s()}
        unsupportedReason={unsupportedReason}
        onToggle={onToggle}
      />
    ),
    host,
  );
  return { onToggle };
}

const radio = (name: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === name)!;

describe("TxControls", () => {
  it("is a radio group with the mode in force checked", () => {
    mount(session());
    const group = host!.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Modo de transacción");
    expect(radio("Auto").getAttribute("aria-checked")).toBe("true");
    expect(radio("Manual").getAttribute("aria-checked")).toBe("false");
    // One tab stop: the checked option.
    expect(radio("Auto").tabIndex).toBe(0);
    expect(radio("Manual").tabIndex).toBe(-1);
  });

  it("switches only when the other option is picked", () => {
    const h = mount(session());
    radio("Auto").click();
    expect(h.onToggle).not.toHaveBeenCalled();
    radio("Manual").click();
    expect(h.onToggle).toHaveBeenCalledOnce();
    expect(radio("Manual").getAttribute("aria-checked")).toBe("true");
  });

  it("moves with the arrow keys", () => {
    const h = mount(session());
    radio("Auto").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(h.onToggle).toHaveBeenCalledOnce();
  });

  it("locks while a transaction is open", () => {
    const h = mount(session({ manual: true, open: true, statements: 2 }));
    expect(radio("Auto").disabled).toBe(true);
    expect(radio("Auto").title).toBe("Confirma o revierte antes la transacción abierta.");
    radio("Auto").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(h.onToggle).not.toHaveBeenCalled();
  });

  it("says why on an engine without transactions", () => {
    mount(session(), "Este motor no admite transacciones.");
    expect(radio("Manual").disabled).toBe(true);
    expect(radio("Manual").title).toBe("Este motor no admite transacciones.");
  });
});
