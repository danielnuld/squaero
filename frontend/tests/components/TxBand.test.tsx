import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import { TxBand } from "../../src/components/TxBand";
import type { TxSession } from "../../src/utils/txMode";

// The open-transaction band (M14 TxManualPending): what waits, and the two ways out.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(session: TxSession, keys = false) {
  const onCommit = vi.fn();
  const onRollback = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <TxBand
        session={session}
        commitKeys={keys ? "Alt+Mayús+C" : undefined}
        rollbackKeys={keys ? "Alt+Mayús+R" : undefined}
        onCommit={onCommit}
        onRollback={onRollback}
      />
    ),
    host,
  );
  return { onCommit, onRollback };
}

const button = (text: string) =>
  [...host!.querySelectorAll("button")].find((b) => b.textContent!.startsWith(text))!;

describe("TxBand", () => {
  it("says how many statements wait, as a named status", () => {
    mount({ manual: true, open: true, statements: 2, log: [] });
    const band = host!.querySelector('[role="status"]')!;
    expect(band.getAttribute("aria-label")).toBe("Transacción abierta");
    expect(band.textContent).toContain("Transacción abierta · 2 sentencias");
    expect(band.textContent).toContain("Solo esta sesión ve los cambios");
  });

  it("uses the singular for one statement", () => {
    mount({ manual: true, open: true, statements: 1, log: [] });
    expect(host!.querySelector(".tx-band-title")!.textContent).toBe("Transacción abierta · 1 sentencia");
  });

  it("commits and rolls back, showing the shortcuts when bound", () => {
    const h = mount({ manual: true, open: true, statements: 1, log: [] }, true);
    expect(button("Commit").textContent).toBe("CommitAlt+Mayús+C");
    button("Commit").click();
    expect(h.onCommit).toHaveBeenCalledOnce();
    button("Revertir").click();
    expect(h.onRollback).toHaveBeenCalledOnce();
  });

  it("lists the statements with the rows each changed", () => {
    mount({
      manual: true,
      open: true,
      statements: 2,
      log: [
        { sql: "UPDATE clientes SET saldo = 0 WHERE id = 4", rows: 1 },
        { sql: "DELETE FROM pedidos", rows: 3 },
        { sql: "CALL x()", rows: null },
      ],
    });
    const rows = [...host!.querySelectorAll(".tx-band-list li")].map((li) => li.textContent);
    expect(rows).toEqual([
      "UPDATE clientes SET saldo = 0 WHERE id = 41 fila",
      "DELETE FROM pedidos3 filas",
      "CALL x()",
    ]);
  });

  it("has no list before any statement ran", () => {
    mount({ manual: false, open: true, statements: 0, log: [] });
    expect(host!.querySelector(".tx-band-list")).toBeNull();
  });
});
