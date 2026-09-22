import { describe, it, expect } from "vitest";
import { matchesConnection, searchGroups } from "../../src/utils/connectionSearch";
import { driverSchema, type Connection } from "../../src/utils/connections";

// Finding a saved connection to open (#525): by name, engine, server or group,
// and without having to type the accent.

const conn = (over: Partial<Connection> & { id: string; name: string }): Connection => ({
  driver: "mysql",
  params: { host: "10.0.4.12", port: "3306", database: "ventas" },
  ...over,
});

const labelOf = (driver: string) => driverSchema(driver)?.label ?? driver;

const ventas = conn({ id: "c1", name: "Ventas", group: "Producción" });
const ventasDev = conn({
  id: "c2",
  name: "Ventas (dev)",
  group: "Desarrollo",
  params: { host: "localhost", port: "13306", database: "ventas" },
});
const nomina = conn({
  id: "c3",
  name: "Nómina",
  driver: "informix",
  group: "Producción",
  params: { host: "sia01", port: "9089", database: "nomina" },
});
const notas = conn({ id: "c4", name: "Notas", driver: "sqlite", params: { path: "C:\\datos\\notas.db" } });
const all = [ventas, ventasDev, nomina, notas];

describe("matchesConnection", () => {
  it("matches everything on an empty query, so the search opens showing the list", () => {
    for (const c of all) expect(matchesConnection(c, "", labelOf(c.driver))).toBe(true);
    expect(matchesConnection(ventas, "   ", labelOf(ventas.driver))).toBe(true);
  });

  it("matches the name without regard to case", () => {
    expect(matchesConnection(ventas, "VENTAS", labelOf(ventas.driver))).toBe(true);
  });

  it("finds an accented name typed without the accent, and the other way round", () => {
    expect(matchesConnection(nomina, "nomina", labelOf(nomina.driver))).toBe(true);
    expect(matchesConnection(nomina, "NÓMINA", labelOf(nomina.driver))).toBe(true);
  });

  it("matches the engine, by its label or by its driver name", () => {
    expect(matchesConnection(nomina, "informix", labelOf(nomina.driver))).toBe(true);
    expect(matchesConnection(ventas, "mariadb", labelOf(ventas.driver))).toBe(true); // label is "MySQL / MariaDB"
    expect(matchesConnection(notas, "sqlite", labelOf(notas.driver))).toBe(true);
  });

  it("matches the server and the port", () => {
    expect(matchesConnection(ventas, "10.0.4", labelOf(ventas.driver))).toBe(true);
    expect(matchesConnection(ventasDev, "13306", labelOf(ventasDev.driver))).toBe(true);
    expect(matchesConnection(nomina, "sia01:9089", labelOf(nomina.driver))).toBe(true);
  });

  it("matches the file of a SQLite connection", () => {
    expect(matchesConnection(notas, "notas.db", labelOf(notas.driver))).toBe(true);
  });

  it("matches the group", () => {
    expect(matchesConnection(ventasDev, "desarrollo", labelOf(ventasDev.driver))).toBe(true);
  });

  it("narrows with every term, instead of widening", () => {
    expect(matchesConnection(ventasDev, "ventas dev", labelOf(ventasDev.driver))).toBe(true);
    // "ventas" matches, "sia01" does not: both have to.
    expect(matchesConnection(ventasDev, "ventas sia01", labelOf(ventasDev.driver))).toBe(false);
  });

  it("does not match what is nowhere in the connection", () => {
    expect(matchesConnection(ventas, "oracle", labelOf(ventas.driver))).toBe(false);
  });
});

describe("searchGroups", () => {
  it("groups the matches, ungrouped first and then alphabetically", () => {
    const groups = searchGroups(all, "", [], labelOf);
    expect(groups.map((g) => g.name)).toEqual([null, "Desarrollo", "Producción"]);
    expect(groups[0].hits.map((h) => h.conn.name)).toEqual(["Notas"]);
    expect(groups[2].hits.map((h) => h.conn.name)).toEqual(["Ventas", "Nómina"]);
  });

  it("marks the ones already open, so picking one only focuses it", () => {
    const groups = searchGroups(all, "ventas", ["c1"], labelOf);
    const hits = groups.flatMap((g) => g.hits);
    expect(hits.map((h) => [h.conn.name, h.isOpen])).toEqual([
      ["Ventas (dev)", false],
      ["Ventas", true],
    ]);
  });

  it("carries the target each row shows under the name", () => {
    const [group] = searchGroups([nomina], "", [], labelOf);
    expect(group.hits[0].target).toBe("nomina @ sia01:9089");
  });

  it("drops the groups with no match", () => {
    const groups = searchGroups(all, "informix", [], labelOf);
    expect(groups.map((g) => g.name)).toEqual(["Producción"]);
    expect(groups[0].hits).toHaveLength(1);
  });

  it("returns nothing when nothing matches, so the popover can say so", () => {
    expect(searchGroups(all, "no-existe", [], labelOf)).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const order = all.map((c) => c.id);
    searchGroups(all, "", [], labelOf);
    expect(all.map((c) => c.id)).toEqual(order);
  });
});
