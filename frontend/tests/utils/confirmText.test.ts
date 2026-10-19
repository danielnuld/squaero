import { describe, it, expect, afterEach } from "vitest";
import {
  clearHistoryConfirm,
  countText,
  deleteCellConfirm,
  deleteNotebookConfirm,
  deleteRowsConfirm,
  dropColumnsConfirm,
  dropConfirm,
  dropConsequences,
  isDestructiveSql,
  killSessionConfirm,
  needsTypedName,
  resetStatsConfirm,
  restoreConfirm,
  revokeConfirm,
} from "../../src/utils/confirmText";
import { setLocale } from "../../src/utils/i18n";

afterEach(() => setLocale("es"));

describe("dropConfirm", () => {
  it("names the kind and the object, and the button says what it deletes", () => {
    const c = dropConfirm("table", "clientes", "Ventas › main");
    expect(c.title).toBe("¿Eliminar la tabla clientes?");
    expect(c.message).toBe("Se eliminará de Ventas › main. Esta acción no se puede deshacer.");
    expect(c.confirm).toBe("Eliminar tabla");
  });

  it("covers every kind the app deletes", () => {
    expect(dropConfirm("view", "v").confirm).toBe("Eliminar vista");
    expect(dropConfirm("function", "f").title).toBe("¿Eliminar la función f?");
    expect(dropConfirm("index", "ix_a").confirm).toBe("Eliminar índice");
    expect(dropConfirm("constraint", "fk_a").confirm).toBe("Eliminar restricción");
    expect(dropConfirm("user", "ana@%").title).toBe("¿Eliminar el usuario ana@%?");
  });

  it("says it cannot be undone even without a place", () => {
    expect(dropConfirm("trigger", "t").message).toBe("Esta acción no se puede deshacer.");
  });

  it("speaks English too", () => {
    setLocale("en");
    expect(dropConfirm("table", "clientes").title).toBe("Delete the table clientes?");
    expect(dropConfirm("table", "clientes").confirm).toBe("Delete table");
  });
});

describe("countText", () => {
  it("picks the singular for one and the plural otherwise", () => {
    expect(countText("confirm.history.button", 1)).toBe("Eliminar 1 consulta");
    expect(countText("confirm.history.button", 0)).toBe("Eliminar 0 consultas");
    expect(countText("confirm.history.button", 12)).toBe("Eliminar 12 consultas");
  });
});

describe("the other confirmations", () => {
  it("killing a session names it and the server", () => {
    const c = killSessionConfirm("4127", "Producción");
    expect(c.title).toBe("¿Terminar la sesión 4127 en Producción?");
    expect(c.confirm).toBe("Terminar sesión 4127");
  });

  it("clearing the history counts what goes", () => {
    expect(clearHistoryConfirm(3).message).toContain("las 3 consultas");
    expect(clearHistoryConfirm(1).confirm).toBe("Eliminar 1 consulta");
  });

  it("restoring names the file, the statements and the target", () => {
    const c = restoreConfirm("dump.sql", 214, "Ventas › main");
    expect(c.title).toBe("¿Restaurar sobre Ventas › main?");
    expect(c.message).toContain("214 sentencias de dump.sql sobre Ventas › main");
    expect(c.confirm).toBe("Restaurar 214 sentencias");
    expect(restoreConfirm("a.sql", 1, "x").confirm).toBe("Restaurar 1 sentencia");
  });
});

describe("isDestructiveSql", () => {
  it("spots what throws data away", () => {
    expect(isDestructiveSql("DROP TABLE clientes")).toBe(true);
    expect(isDestructiveSql("  truncate pedidos")).toBe(true);
    expect(isDestructiveSql('ALTER TABLE "clientes" DROP COLUMN "telefono"')).toBe(true);
    expect(isDestructiveSql("-- limpiar\nDROP VIEW v")).toBe(true);
    expect(isDestructiveSql("/* x */ drop index ix")).toBe(true);
    expect(isDestructiveSql("db.clientes.drop()")).toBe(true);
  });

  it("does not count a DROP that is only text", () => {
    expect(isDestructiveSql("INSERT INTO log VALUES ('drop table x')")).toBe(false);
    expect(isDestructiveSql("UPDATE t SET a = 1")).toBe(false);
    expect(isDestructiveSql("ALTER TABLE t ADD COLUMN dropped int")).toBe(false);
    expect(isDestructiveSql("")).toBe(false);
  });
});

describe("needsTypedName", () => {
  it("asks only on a protected connection and only for what loses data", () => {
    expect(needsTypedName("confirm", ["INSERT INTO t VALUES (1)", "DROP TABLE t"])).toBe(true);
    expect(needsTypedName("confirm", ["INSERT INTO t VALUES (1)"])).toBe(false);
    expect(needsTypedName(undefined, ["DROP TABLE t"])).toBe(false);
    expect(needsTypedName("readOnly", ["DROP TABLE t"])).toBe(false);
  });
});

describe("dropColumnsConfirm", () => {
  it("names the one column and the table", () => {
    const c = dropColumnsConfirm("clientes", ["email"]);
    expect(c.title).toBe("¿Eliminar la columna email de clientes?");
    expect(c.message).toContain("la columna email y todos sus datos");
    expect(c.confirm).toBe("Eliminar columna email");
  });

  it("counts several and lists every one", () => {
    const c = dropColumnsConfirm("clientes", ["email", "telefono"]);
    expect(c.title).toBe("¿Eliminar 2 columnas de clientes?");
    expect(c.message).toContain("las columnas email, telefono");
    expect(c.confirm).toBe("Eliminar 2 columnas");
  });
});

describe("deleteRowsConfirm", () => {
  it("names the table and the row by its key", () => {
    const c = deleteRowsConfirm("clientes", ["id 2"]);
    expect(c.title).toBe("¿Eliminar 1 fila de clientes?");
    expect(c.message).toBe("Se eliminará de forma permanente la fila id 2 de clientes.");
    expect(c.confirm).toBe("Eliminar 1 fila de clientes");
  });

  it("lists the first rows, counts the rest, and names the dependants", () => {
    const rows = ["id 1", "id 2", "id 3", "id 4", "id 5", "id 6", "id 7"];
    const c = deleteRowsConfirm("clientes", rows, ["pedidos.cliente_id"]);
    expect(c.title).toBe("¿Eliminar 7 filas de clientes?");
    expect(c.message).toContain("7 filas de clientes: id 1, id 2, id 3, id 4, id 5 y 2 más.");
    expect(c.message).toContain("(pedidos.cliente_id)");
    expect(c.confirm).toBe("Eliminar 7 filas de clientes");
  });
});

describe("the tool confirmations of audit P1", () => {
  it("revoking names who, what and where, and counts the privileges", () => {
    const c = revokeConfirm("app@%", ["SELECT", "INSERT"], "`shop`.*");
    expect(c.title).toBe("¿Revocar permisos a app@%?");
    expect(c.message).toBe("app@% dejará de tener SELECT, INSERT sobre `shop`.*.");
    expect(c.confirm).toBe("Revocar 2 permisos");
  });

  it("resetting the statistics counts what is recorded", () => {
    expect(resetStatsConfirm(12).message).toContain("las 12 consultas registradas");
    expect(resetStatsConfirm(1).message).toContain("la consulta registrada");
  });

  it("deleting a notebook names it and counts its cells", () => {
    const c = deleteNotebookConfirm("Ventas", 3);
    expect(c.title).toBe("¿Eliminar el notebook Ventas?");
    expect(c.message).toContain("sus 3 celdas");
  });

  it("deleting a cell shows its number and first line, cut when long", () => {
    const c = deleteCellConfirm(2, "  DELETE FROM pedidos\nWHERE id = 1");
    expect(c.title).toBe("¿Eliminar la celda [2]?");
    expect(c.message).toBe("Se pierde su contenido: DELETE FROM pedidos");
    expect(deleteCellConfirm(1, "x".repeat(80)).message).toContain(`${"x".repeat(60)}…`);
  });
});

describe("dropConsequences", () => {
  it("says what goes with the table and who references it", () => {
    expect(dropConsequences({ rows: 12, indexes: 2, dependants: ["pedidos.cliente_id"] })).toEqual([
      "Con ella se eliminan 12 filas y 2 índices.",
      "pedidos.cliente_id referencia esta tabla: quedará apuntando a filas que ya no existen, o el motor rechazará la eliminación.",
    ]);
  });

  it("uses the singular and leaves out what is unknown", () => {
    expect(dropConsequences({ rows: 1 })).toEqual(["Con ella se eliminan 1 fila."]);
    expect(dropConsequences({ indexes: 3 })).toEqual(["Con ella se eliminan 3 índices."]);
    expect(dropConsequences({ rows: null, indexes: 0 })).toEqual([]);
    expect(dropConsequences({})).toEqual([]);
    expect(dropConsequences({ dependants: ["a.x", "b.y"] })[0]).toMatch(/^a\.x, b\.y referencian esta tabla/);
  });
});

// Rule 9 / A-26: every count in the UI reads as Spanish does — «1 fila»,
// «0 filas» — through a .one/.other pair, in both catalogs.
describe("plural keys", () => {
  it("every .one has its .other, in es and en", async () => {
    const { es } = await import("../../src/utils/messages/es");
    const { en } = await import("../../src/utils/messages/en");
    for (const cat of [es, en] as Record<string, string>[]) {
      for (const key of Object.keys(cat)) {
        const m = /^(.*)\.one$/.exec(key);
        if (m) expect(cat[`${m[1]}.other`], key).toBeDefined();
      }
    }
  });
  it("read the singular for 1 and the plural otherwise", () => {
    expect(countText("grid.rowsAffected", 1)).toBe("1 fila afectada.");
    expect(countText("grid.rowsAffected", 0)).toBe("0 filas afectadas.");
    expect(countText("monitor.sessions", 3)).toBe("3 sesiones");
    expect(countText("ds.matches", 50, { n: "≥ 50" })).toBe("≥ 50 filas");
    setLocale("en");
    expect(countText("tx.openTitle", 1)).toContain("1 statement ran in it and is not");
    expect(countText("er.edges", 2)).toBe("2 relationships");
  });
});
