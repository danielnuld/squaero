import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { ErrorHints } from "../../src/components/ErrorHints";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const mount = (ui: () => any) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(ui, host);
};

describe("ErrorHints (#691)", () => {
  it("offers the ways on from a write a protected connection refused (M14 SafeModeReadonly)", () => {
    let other = 0;
    let change = 0;
    mount(() => (
      <ErrorHints
        code={null}
        hint={null}
        safeBlock={{ onOtherConnection: () => other++, onChangeProtection: () => change++ }}
      />
    ));
    const buttons = [...host!.querySelectorAll<HTMLButtonElement>("dd button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Ejecutar en otra conexión…", "Cambiar la protección…"]);
    buttons[0].click();
    buttons[1].click();
    expect([other, change]).toEqual([1, 1]);
  });

  it("asks about an open transaction on a lock error, and goes to its tab (A-07)", () => {
    let went = 0;
    mount(() => <ErrorHints code={null} hint={null} lock onLockTab={() => went++} />);
    expect(host!.querySelector("dt")!.textContent).toBe("Bloqueo");
    expect(host!.querySelector("dd")!.textContent).toContain("¿Hay una transacción abierta en otra pestaña?");
    host!.querySelector<HTMLButtonElement>("dd button")!.click();
    expect(went).toBe(1);
  });

  it("asks without a button when no tab holds a transaction", () => {
    mount(() => <ErrorHints code={null} hint={null} lock />);
    expect(host!.querySelector("dd button")).toBeNull();
  });

  it("renders nothing with nothing to add", () => {
    mount(() => <ErrorHints code={null} hint={null} />);
    expect(host!.querySelector(".error-hints")).toBeNull();
  });

  it("shows the engine's code", () => {
    mount(() => <ErrorHints code="SQLCODE -206 · SQLSTATE 42000" hint={null} />);
    expect(host!.querySelector("dt")!.textContent).toBe("Código");
    expect(host!.querySelector("dd")!.textContent).toBe("SQLCODE -206 · SQLSTATE 42000");
  });

  it("suggests the close column and says where it looked", () => {
    mount(() => (
      <ErrorHints
        code={null}
        hint={{ kind: "column", name: "nombres", suggestion: "nombre", tables: ["clientes"] }}
      />
    ));
    expect(host!.querySelector("dt")!.textContent).toBe("Columna");
    expect(host!.querySelector("dd")!.textContent).toBe("¿Querías «nombre»? (columnas de clientes)");
  });

  it("suggests a table", () => {
    mount(() => <ErrorHints code={null} hint={{ kind: "table", name: "cliente", suggestion: "clientes" }} />);
    expect(host!.querySelector("dt")!.textContent).toBe("Tabla");
    expect(host!.querySelector("code")!.textContent).toBe("clientes");
  });
});
