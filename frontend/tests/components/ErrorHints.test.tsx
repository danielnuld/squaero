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
