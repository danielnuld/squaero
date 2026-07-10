import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { StructureView } from "../../src/components/StructureView";

// Drives the real structure modal against a mocked bridge to check view editing
// (issue #108): load the DDL, edit it, and apply it as DROP+CREATE (sqlite) in a
// transaction.

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as BridgeHost).quaeroRpc;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function installBridge() {
  const calls: { method: string; params: any }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
    calls.push({ method: req.method, params: req.params });
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    switch (req.method) {
      case "schema.describe":
        return ok({
          columns: [{ name: "name", type: "text" }],
          rows: [["id"]],
          truncated: false,
          rowsAffected: 0,
        });
      case "schema.ddl":
        return ok({
          columns: [{ name: "sql", type: "text" }],
          rows: [['CREATE VIEW "v" AS SELECT 1']],
          truncated: false,
          rowsAffected: 0,
        });
      case "query.run":
        return ok({ columns: [], rows: [], truncated: false, rowsAffected: 0 });
      default: // tx.begin / tx.commit / tx.rollback
        return ok({ ok: true });
    }
  };
  return calls;
}

const clickText = (text: string) => {
  const btn = [...host!.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement;
  btn.click();
};

describe("StructureView view editing", () => {
  it("applies an edited view as DROP+CREATE in a transaction", async () => {
    const calls = installBridge();
    const onApplied = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <StructureView
            connId="c1"
            table="v"
            kind="view"
            engine="sqlite"
            onClose={() => {}}
            onApplied={onApplied}
          />
        ),
        host!,
      );
    });

    await flush(); // schema.describe + schema.ddl resolve
    expect(host!.textContent).toContain('CREATE VIEW "v"');

    clickText("Editar definición");
    const ta = host!.querySelector("textarea.ddl-edit") as HTMLTextAreaElement;
    expect(ta).not.toBeNull();

    clickText("Aplicar");
    await flush();

    const methods = calls.map((c) => c.method);
    expect(methods).toContain("tx.begin");
    expect(methods).toContain("tx.commit");
    const runs = calls.filter((c) => c.method === "query.run").map((c) => c.params.sql);
    expect(runs[0]).toBe('DROP VIEW IF EXISTS "v"');
    expect(runs[1]).toBe('CREATE VIEW "v" AS SELECT 1');
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(host!.textContent).toContain("Vista actualizada.");
  });

  it("beautifies the view definition in the editor when Formatear is clicked", async () => {
    installBridge();
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <StructureView connId="c1" table="v" kind="view" engine="sqlite" onClose={() => {}} />
        ),
        host!,
      );
    });
    await flush();
    clickText("Editar definición");
    const ta = host!.querySelector("textarea.ddl-edit") as HTMLTextAreaElement;
    // The mocked DDL is a single line; formatting spreads it across lines.
    expect(ta.value.includes("\n")).toBe(false);
    clickText("Formatear");
    const after = (host!.querySelector("textarea.ddl-edit") as HTMLTextAreaElement).value;
    expect(after.includes("\n")).toBe(true);
    expect(after).toMatch(/create view/i);
  });

  it("shows no edit button for a table", async () => {
    installBridge();
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <StructureView connId="c1" table="t" kind="table" engine="sqlite" onClose={() => {}} />
        ),
        host!,
      );
    });
    await flush();
    const hasEdit = [...host!.querySelectorAll("button")].some((b) =>
      b.textContent?.includes("Editar definición"),
    );
    expect(hasEdit).toBe(false);
  });

  // Regression (Informix): when schema.ddl fails (engine can't produce a CREATE),
  // the column structure must still render — a failing DDL call must not hide it.
  it("still shows the columns when the DDL call errors", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string };
      if (req.method === "schema.describe") {
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            columns: [{ name: "name", type: "text" }, { name: "pk", type: "int" }],
            rows: [["id", "1"]],
            truncated: false,
            rowsAffected: 0,
          },
        };
      }
      // schema.ddl → domain error (unsupported), like Informix before get_ddl.
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32001, message: "get_ddl not supported" },
      };
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <StructureView connId="c1" table="t" kind="table" engine="informix" onClose={() => {}} />
        ),
        host!,
      );
    });
    await flush();
    // Columns render...
    expect(host!.querySelector("table.struct-table")).not.toBeNull();
    expect(host!.textContent).toContain("id");
    // ...and the DDL area degrades to a note instead of taking down the view.
    expect(host!.textContent).toContain("DDL no disponible");
  });
});
