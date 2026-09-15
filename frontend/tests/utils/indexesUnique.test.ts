import { describe, it, expect } from "vitest";
import { uniqueSetsFrom } from "../../src/utils/indexes";

// Unique column sets read from the index catalog (#517), to warn about a new
// row's duplicate values before saving.
describe("uniqueSetsFrom", () => {
  const listed = ["name", "columnas", "unico"];

  it("reads MySQL's unique indexes and leaves out the primary key", () => {
    const rows = [
      ["PRIMARY", "id", "Sí"],
      ["uq_email", "email", "Sí"],
      ["ix_ciudad", "ciudad", "No"],
      ["uq_nombre_rfc", "nombre, rfc", "Sí"],
    ];
    expect(uniqueSetsFrom("mysql", listed, rows, ["id"])).toEqual([["email"], ["nombre", "rfc"]]);
  });

  it("reads SQLite's the same way, and MariaDB counts as MySQL", () => {
    const rows = [["sqlite_autoindex_t_1", "codigo", "Sí"]];
    expect(uniqueSetsFrom("sqlite", listed, rows, ["id"])).toEqual([["codigo"]]);
    expect(uniqueSetsFrom("mariadb", listed, rows, ["id"])).toEqual([["codigo"]]);
  });

  it("leaves out a composite primary key whatever the order and case", () => {
    const rows = [["PRIMARY", "B, a", "Sí"]];
    expect(uniqueSetsFrom("mysql", listed, rows, ["a", "b"])).toEqual([]);
  });

  it("skips a unique row with no columns", () => {
    expect(uniqueSetsFrom("mysql", listed, [["x", null, "Sí"]], [])).toEqual([]);
  });

  it("reads plain PostgreSQL unique index definitions", () => {
    const cols = ["name", "definicion"];
    const rows = [
      ["clientes_pkey", "CREATE UNIQUE INDEX clientes_pkey ON public.clientes USING btree (id)"],
      ["uq_email", "CREATE UNIQUE INDEX uq_email ON public.clientes USING btree (email)"],
      ["uq_pair", 'CREATE UNIQUE INDEX uq_pair ON public.clientes USING btree ("Nombre", rfc)'],
      ["ix_ciudad", "CREATE INDEX ix_ciudad ON public.clientes USING btree (ciudad)"],
    ];
    expect(uniqueSetsFrom("postgres", cols, rows, ["id"])).toEqual([["email"], ["Nombre", "rfc"]]);
  });

  it("skips PostgreSQL indexes it cannot read as plain column sets", () => {
    const cols = ["name", "definicion"];
    const rows = [
      ["expr", "CREATE UNIQUE INDEX expr ON public.t USING btree (lower(email))"],
      ["partial", "CREATE UNIQUE INDEX partial ON public.t USING btree (email) WHERE (activo = 1)"],
      ["opclass", "CREATE UNIQUE INDEX opclass ON public.t USING btree (email text_pattern_ops)"],
      ["include", "CREATE UNIQUE INDEX inc ON public.t USING btree (email) INCLUDE (nombre)"],
    ];
    expect(uniqueSetsFrom("postgres", cols, rows, ["id"])).toEqual([]);
  });

  it("gives nothing for Informix, whose listing has no columns, or an unknown engine", () => {
    expect(uniqueSetsFrom("informix", ["name", "unico"], [["ix", "Sí"]], ["id"])).toEqual([]);
    expect(uniqueSetsFrom("oracle", listed, [["x", "a", "Sí"]], [])).toEqual([]);
  });

  it("gives nothing when the listing lacks the expected columns", () => {
    expect(uniqueSetsFrom("mysql", ["name"], [["x"]], [])).toEqual([]);
    expect(uniqueSetsFrom("postgres", ["name"], [["x"]], [])).toEqual([]);
  });
});
