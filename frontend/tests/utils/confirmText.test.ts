import { describe, it, expect, afterEach } from "vitest";
import {
  clearHistoryConfirm,
  countText,
  dropColumnsConfirm,
  dropConfirm,
  isDestructiveSql,
  killSessionConfirm,
  needsTypedName,
  restoreConfirm,
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
