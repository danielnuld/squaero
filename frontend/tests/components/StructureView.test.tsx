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
    // SQLite has no OR REPLACE, so the definition is shown as the two statements
    // that actually re-create the view (issue #454); formatting spreads them.
    const before = ta.value;
    expect(before).toMatch(/^drop view if exists/i);
    clickText("Formatear");
    const after = (host!.querySelector("textarea.ddl-edit") as HTMLTextAreaElement).value;
    expect(after.split("\n").length).toBeGreaterThan(before.split("\n").length);
    expect(after).toMatch(/create view/i);
  });

  it("beautifies the view definition with Ctrl+Shift+F in the editor", async () => {
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
    const before = ta.value;
    ta.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F", ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    const after = (host!.querySelector("textarea.ddl-edit") as HTMLTextAreaElement).value;
    expect(after.split("\n").length).toBeGreaterThan(before.split("\n").length);
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
    // A table opens on its columns, so reach the DDL section before looking:
    // otherwise the assertion would pass just because the section is hidden.
    clickText("DDL");
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
    // Columns render, which is the regression this pins...
    expect(host!.querySelector("table.struct-table")).not.toBeNull();
    expect(host!.textContent).toContain("id");
    // ...and the DDL section, one click away, degrades to a note rather than
    // taking down the panel (the sections of issue #408 moved it, not removed it).
    clickText("DDL");
    expect(host!.textContent).toContain("DDL no disponible");
  });
});

// Structure and definition are sections of one panel (issue #408). They used to
// share the pane, so a view was edited in the bottom half under a column list
// that editing does not need.
describe("StructureView sections", () => {
  const mount = (kind: "view" | "table", table = "v") => {
    installBridge();
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <StructureView connId="c1" table={table} kind={kind} engine="sqlite" onClose={() => {}} />
        ),
        host!,
      );
    });
  };

  it("opens a view on its definition, not on its columns", async () => {
    mount("view");
    await flush();
    expect(host!.textContent).toContain('CREATE VIEW "v"');
    expect(host!.querySelector("table.struct-table")).toBeNull();
  });

  it("opens a table on its columns", async () => {
    mount("table", "t");
    await flush();
    expect(host!.querySelector("table.struct-table")).not.toBeNull();
    expect(host!.querySelector("pre.ddl-text")).toBeNull();
  });

  it("switches between the two", async () => {
    mount("view");
    await flush();
    clickText("Estructura");
    expect(host!.querySelector("table.struct-table")).not.toBeNull();
    expect(host!.querySelector("pre.ddl-text")).toBeNull();
    clickText("Definición");
    expect(host!.querySelector("pre.ddl-text")).not.toBeNull();
    expect(host!.querySelector("table.struct-table")).toBeNull();
  });

  it("locks the sections while editing, so a draft cannot be walked away from", async () => {
    mount("view");
    await flush();
    clickText("Editar definición");
    const tab = [...host!.querySelectorAll("button")].find(
      (b) => b.textContent === "Estructura",
    ) as HTMLButtonElement;
    expect(tab.disabled).toBe(true);
    tab.click();
    expect(host!.querySelector("textarea.ddl-edit")).not.toBeNull();
  });

  it("a view's definition is only shown for the section on screen", async () => {
    // Copiar DDL and Editar definición belong to the definition; on the columns
    // section they would act on something the user cannot see.
    mount("view");
    await flush();
    clickText("Estructura");
    const labels = [...host!.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).not.toContain("Copiar DDL");
    expect(labels.some((l) => l?.includes("Editar definición"))).toBe(false);
  });
});

// Audit A-28: a table's structure is its columns with readable headers and the
// sections around them — indexes, keys both ways and triggers — each one loaded
// on its own and honest about what the engine cannot say.
describe("StructureView table sections", () => {
  const mountTable = (props: Record<string, unknown> = {}) => {
    const calls: string[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (cols: string[], rows: (string | null)[][]) => ({
        jsonrpc: "2.0",
        id: req.id,
        result: { columns: cols.map((name) => ({ name, type: "text" })), rows, truncated: false, rowsAffected: 0 },
      });
      if (req.method === "schema.describe")
        return ok(["name", "type", "notnull", "dflt_value", "pk"], [
          ["id", "INTEGER", "1", null, "1"],
          ["cliente_id", "INTEGER", "0", null, "0"],
        ]);
      if (req.method === "schema.ddl") return ok(["sql"], [["CREATE TABLE pedidos (id INTEGER)"]]);
      const sql: string = req.params.sql;
      calls.push(sql);
      if (sql.includes("pragma_index_list")) return ok(["name", "columnas", "unico"], [["ix_cli", "cliente_id", "No"]]);
      if (sql.includes("pragma_foreign_key_list")) {
        // Outbound for this table, nothing inbound.
        return sql.includes("m.name = 'pedidos'")
          ? ok(["from_table", "from_column", "to_table", "to_column", "constraint_name", "position"], [
              ["pedidos", "cliente_id", "clientes", "id", "0", "1"],
            ])
          : ok(["from_table", "from_column", "to_table", "to_column"], []);
      }
      if (sql.includes("type = 'trigger'")) return ok(["name", "table", "sql"], [["trg", "pedidos", "CREATE TRIGGER trg"]]);
      return ok([], []);
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => <StructureView connId="c1" table="pedidos" kind="table" engine="sqlite" onClose={() => {}} {...props} />,
        host!,
      );
    });
    return calls;
  };

  it("shows the summary, readable headers and what each column takes part in", async () => {
    const calls = mountTable();
    await flush();
    await flush();
    const text = host!.textContent ?? "";
    // SQLite keeps no row statistic: no count, and never a COUNT(*) to get one.
    expect(text).toContain("Tabla · 2 columnas · 1 índice");
    expect(calls.some((sql) => /COUNT\(\*\)/i.test(sql))).toBe(false);
    const headers = [...host!.querySelectorAll("table.struct-table th")].map((th) => th.textContent);
    expect(headers.slice(0, 6)).toEqual(["#", "Nombre", "Tipo", "Admite NULL", "Por defecto", "Clave / índice"]);
    expect(text).toContain("Clave primaria");
    expect(text).toContain("Índice · ix_cli · Referencia a clientes.id");
  });

  it("lists indexes, foreign keys, referencing tables and triggers as sections", async () => {
    mountTable();
    await flush();
    await flush();
    const titles = [...host!.querySelectorAll(".struct-sec h2")].map((h) => h.textContent);
    expect(titles).toEqual(["Columnas", "Índices", "Claves foráneas", "Referenciada por", "Triggers"]);
    expect(host!.textContent).toContain("Ninguna tabla referencia pedidos.");
    expect(host!.textContent).toContain("trg");
  });

  it("opens the referenced table and the index manager from their sections", async () => {
    const onOpenObject = vi.fn();
    const onView = vi.fn();
    mountTable({ onOpenObject, onView });
    await flush();
    await flush();
    clickText("clientes.id");
    expect(onOpenObject).toHaveBeenCalledWith("clientes");
    clickText("Gestionar índices");
    expect(onView).toHaveBeenCalledWith("indexes");
  });

  it("says a section is unavailable rather than hiding it (Informix triggers have no table)", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string };
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { columns: [{ name: "name", type: "text" }], rows: [["x"]], truncated: false, rowsAffected: 0 },
      };
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <StructureView connId="c1" table="t" kind="table" engine="informix" onClose={() => {}} />, host!);
    });
    await flush();
    await flush();
    expect(host!.textContent).toContain("No disponible: este motor no lo expone.");
  });

  it("offers Modificar tabla and, on the DDL, opening it in the editor", async () => {
    const onModify = vi.fn();
    const onOpenSql = vi.fn();
    mountTable({ onModify, onOpenSql, onView: () => {} });
    await flush();
    clickText("Modificar tabla");
    expect(onModify).toHaveBeenCalled();
    clickText("DDL");
    expect(host!.querySelector("pre.ddl-text .tok-keyword")).not.toBeNull();
    clickText("Abrir en el editor");
    expect(onOpenSql).toHaveBeenCalledWith("CREATE TABLE pedidos (id INTEGER)");
  });

  it("does not offer Índices for a view", async () => {
    installBridge();
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <StructureView connId="c1" table="v" kind="view" engine="sqlite" onClose={() => {}} onView={() => {}} />, host!);
    });
    await flush();
    const tabs = [...host!.querySelectorAll('[role="tab"]')].map((b) => b.textContent);
    expect(tabs).not.toContain("Índices");
  });
});

describe("StructureView row estimate", () => {
  it("shows the catalog's statistic as approximate, without a COUNT(*)", async () => {
    const sqls: string[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (cols: string[], rows: (string | null)[][]) => ({
        jsonrpc: "2.0",
        id: req.id,
        result: { columns: cols.map((name) => ({ name, type: "text" })), rows, truncated: false, rowsAffected: 0 },
      });
      if (req.method === "schema.describe") return ok(["name", "type", "notnull", "dflt_value", "pk"], [["id", "int", "1", null, "1"]]);
      if (req.method === "schema.ddl") return ok(["sql"], [["CREATE TABLE pedidos (id int)"]]);
      sqls.push(req.params.sql);
      if (req.params.sql.includes("TABLE_ROWS AS n")) return ok(["name", "n"], [["otra", "5"], ["Pedidos", "1240"]]);
      return ok([], []);
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <StructureView connId="c1" table="pedidos" db="ventas" kind="table" engine="mysql" onClose={() => {}} />, host!);
    });
    await flush();
    await flush();
    expect(host!.querySelector(".struct-summary")!.textContent).toContain("≈ 1240 filas");
    expect(sqls.some((sql) => /COUNT\(\*\)/i.test(sql))).toBe(false);
  });
});
