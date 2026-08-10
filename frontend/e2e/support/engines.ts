// The engine matrix: how to reach each database, and the fixture every test starts
// from. Everything engine-specific lives here so a test reads the same for all four.
//
// The containers these DSNs point at are the ones created for the encoding work
// (issue #323); e2e/README.md has the commands to start them.

import { join } from "node:path";
import { tmpdir } from "node:os";

export type EngineName = "sqlite" | "postgres" | "mysql" | "informix";

export interface EngineSpec {
  readonly name: EngineName;
  /** Driver name the core registers, and the DSN the frontend would store. */
  readonly driver: string;
  readonly dsn: Record<string, string>;
  /** Human label for the saved connection, used by tests to click it. */
  readonly label: string;
  /** Statements that build the fixture, run in order through the core. */
  readonly fixture: readonly string[];
  /**
   * What the grid MUST show for the three encoding rows, per engine.
   *
   * These differ on purpose, and that is the whole point: the same bytes mean
   * different things depending on what the database declares. MySQL's "latin1" is
   * really CP1252, so 0x93/0x94 are typographic quotes there, while PostgreSQL's
   * true ISO 8859-1 maps them to the C1 controls U+0093/U+0094. Asserting one
   * expectation for every engine would be asserting a bug.
   */
  readonly encodingRows: {
    /** Bytes C3 B1: valid UTF-8 for "ñ", but "Ã±" in a single-byte code set. */
    readonly discriminator: string;
    /** A plain accented value. */
    readonly accented: string;
  };
  /** How this engine spells "drop the fixture table if it is there". */
  readonly dropFixture: string;
  /**
   * Statements that add `BULK_ROWS` more rows in one go, for the paging case.
   *
   * One statement per engine rather than a thousand INSERTs, and engine-specific
   * because there is no portable row generator: PostgreSQL has generate_series,
   * SQLite and MySQL have recursive CTEs (MySQL's needs its recursion cap raised
   * past the default 1000), and Informix has neither — so it cross-joins systables
   * with itself and derives a unique id from the two tabids.
   */
  readonly bulk: readonly string[];
  /**
   * Container nodes to expand, in order, to reach the fixture table in the object
   * tree. The shape genuinely differs: PostgreSQL puts a schema between the
   * database and the tables, and opens its active database already expanded, while
   * SQLite calls its only schema "main".
   */
  readonly treePath: readonly string[];
}

/**
 * Rows the paging case adds on top of the base fixture. The grid pages at 1000, so
 * this has to clear that on its own.
 */
export const BULK_ROWS = 1200;

/**
 * Filler rows, so paging has something to page through.
 *
 * The fixture needs a PRIMARY KEY: without one the grid opens read-only ("la tabla
 * no tiene clave primaria") and the editing cases could never run at all.
 */
export const FILLER_ROWS = 25;

const SQLITE_FILE = join(tmpdir(), "quaero-e2e.sqlite");

/** Filler inserts shared by the SQL engines (all accept the same literal form). */
function filler(): string[] {
  const rows: string[] = [];
  for (let i = 1; i <= FILLER_ROWS; i++) {
    rows.push(
      `INSERT INTO e2e_items (id, nombre) VALUES (${i + 10}, 'fila ${String(i).padStart(2, "0")}')`,
    );
  }
  return rows;
}

export const ENGINES: readonly EngineSpec[] = [
  {
    name: "sqlite",
    driver: "sqlite",
    // A file, not ":memory:": the harness seeds through its own connection, and an
    // in-memory database would be invisible to the one the page opens.
    dsn: { path: SQLITE_FILE },
    label: "E2E SQLite",
    dropFixture: "DROP TABLE IF EXISTS e2e_items",
    fixture: [
      "CREATE TABLE e2e_items (id INTEGER PRIMARY KEY, nombre TEXT)",
      "INSERT INTO e2e_items (id, nombre) VALUES (1, 'Nogales')",
      // SQLite is UTF-8 by definition, so the discriminating bytes simply are the
      // UTF-8 for "Ã±" and there is no ambiguity to resolve.
      "INSERT INTO e2e_items (id, nombre) VALUES (2, 'Ã±')",
      "INSERT INTO e2e_items (id, nombre) VALUES (3, 'Cd. Obregón')",
      ...filler(),
    ],
    encodingRows: { discriminator: "Ã±", accented: "Cd. Obregón" },
    bulk: [
      `INSERT INTO e2e_items (id, nombre) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${BULK_ROWS}) SELECT i+1000, 'fila '||i FROM n`,
    ],
    treePath: ["main", "Tablas"],
  },
  {
    name: "postgres",
    driver: "postgres",
    dsn: {
      host: "127.0.0.1",
      port: "15432",
      user: "postgres",
      password: "test123",
      database: "testdb",
    },
    label: "E2E PostgreSQL",
    dropFixture: "DROP TABLE IF EXISTS e2e_items",
    fixture: [
      "CREATE TABLE e2e_items (id int PRIMARY KEY, nombre text)",
      "INSERT INTO e2e_items (id, nombre) VALUES (1, 'Nogales')",
      // chr() in a LATIN1 database yields the byte, so this row really holds C3 B1.
      "INSERT INTO e2e_items (id, nombre) VALUES (2, chr(195) || chr(177))",
      "INSERT INTO e2e_items (id, nombre) VALUES (3, 'Cd. Obreg' || chr(243) || 'n')",
      ...filler(),
    ],
    encodingRows: { discriminator: "Ã±", accented: "Cd. Obregón" },
    bulk: [
      `INSERT INTO e2e_items SELECT i+1000, 'fila '||i FROM generate_series(1,${BULK_ROWS}) AS g(i)`,
    ],
    // Three levels: PostgreSQL puts a schema between the database and the tables.
    treePath: ["testdb", "public", "Tablas"],
  },
  {
    name: "mysql",
    driver: "mysql",
    dsn: {
      host: "127.0.0.1",
      port: "13306",
      user: "root",
      password: "test123",
      database: "testdb",
    },
    label: "E2E MySQL",
    dropFixture: "DROP TABLE IF EXISTS e2e_items",
    fixture: [
      "CREATE TABLE e2e_items (id int PRIMARY KEY, nombre varchar(60)) CHARACTER SET latin1",
      "INSERT INTO e2e_items (id, nombre) VALUES (1, 'Nogales')",
      "INSERT INTO e2e_items (id, nombre) VALUES (2, _latin1 X'C3B1')",
      "INSERT INTO e2e_items (id, nombre) VALUES (3, _latin1 X'43642E204F62726567F36E')",
      ...filler(),
    ],
    encodingRows: { discriminator: "Ã±", accented: "Cd. Obregón" },
    bulk: [
      // The recursive-CTE depth cap defaults to 1000, one short of what we need.
      "SET SESSION cte_max_recursion_depth = 5000",
      `INSERT INTO e2e_items (id, nombre) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${BULK_ROWS}) SELECT i+1000, CONCAT('fila ',i) FROM n`,
    ],
    treePath: ["testdb", "Tablas"],
  },
  {
    name: "informix",
    driver: "informix",
    dsn: {
      host: "127.0.0.1",
      port: "9088",
      server: "informix",
      database: "quaero_enc",
      user: "informix",
      password: "in4mix",
    },
    label: "E2E Informix",
    // Informix has no "IF EXISTS" on DROP TABLE in every version in play, so the
    // seeder tolerates this statement failing.
    dropFixture: "DROP TABLE e2e_items",
    fixture: [
      "CREATE TABLE e2e_items (id INT PRIMARY KEY, nombre VARCHAR(60))",
      "INSERT INTO e2e_items VALUES (1, 'Nogales')",
      "INSERT INTO e2e_items VALUES (2, CHR(195) || CHR(177))",
      "INSERT INTO e2e_items VALUES (3, 'Cd. Obreg' || CHR(243) || 'n')",
      ...filler(),
    ],
    encodingRows: { discriminator: "Ã±", accented: "Cd. Obregón" },
    bulk: [
      // No generator at all: cross-join the catalogue and build a unique id from the
      // two tabids (tabid < 1000, so a*1000+b never collides and never hits 1..35).
      `INSERT INTO e2e_items SELECT FIRST ${BULK_ROWS} a.tabid*1000+b.tabid, 'fila '||(a.tabid*1000+b.tabid) FROM systables a, systables b WHERE a.tabid>0 AND b.tabid>0`,
    ],
    treePath: ["quaero_enc", "Tablas"],
  },
];

export function engineByName(name: EngineName): EngineSpec {
  const found = ENGINES.find((e) => e.name === name);
  if (found === undefined) {
    throw new Error(`unknown engine ${name}`);
  }
  return found;
}

/** The command that starts this engine's container, for the skip message. */
export function startHint(name: EngineName): string {
  switch (name) {
    case "postgres":
      return "docker start quaero-pg-test";
    case "mysql":
      return "docker start quaero-my-test";
    case "informix":
      return "docker start quaero-ifx-test  (takes ~1 min to come online)";
    case "sqlite":
      return "no container needed; check the build produced the sqlite plugin";
  }
}
