// Reads one side of a schema comparison (#672) into a SchemaSnapshot: tables
// and views from schema.tree, columns from schema.describe, view text from
// schema.ddl, and constraints / CHECKs / indexes from per-engine catalog queries
// run through query.run (the IPC contract has no method for them — same
// client-side pattern as utils/indexes.ts and utils/foreignKeys.ts).
//
// Every catalog query aliases its output to one shape, so the parsers below are
// engine-agnostic:
//   constraints — table_name, constraint_name, kind (P/U/F, Informix R),
//                 column_name, position, ref_table, ref_column
//   checks      — table_name, constraint_name, definition
//   indexes     — table_name, index_name, is_unique, column_name, position,
//                 special (1 = expression/partial/prefix/non-B-tree: not compared)
// A query an engine lacks (SQLite and Informix CHECKs, MongoDB everything) or
// one that fails (MySQL 5.7 has no CHECK_CONSTRAINTS) leaves its category in
// `missing`, so the diff reports it as not compared instead of as empty.
//
// The SQL builders and parsers are pure and unit-tested; readSnapshot takes its
// I/O injected.

import type { ResultSet } from "./query";
import { parseTreeRows, quoteIdentifier } from "./schema";
import { engineFamily as family } from "./engineFamily";
import {
  parseStructure,
  type Category,
  type SchemaSnapshot,
  type TableDef,
  type ViewDef,
} from "./schemaDiff";

/** Standard SQL string literal. */
const lit = (s: string) => s.replace(/'/g, "''");
/** MySQL literal: backslash is an escape character there. */
const litMy = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "''");

/** Where the objects live: `db` on MySQL/SQLite/Informix (and SQL Server's
    catalog database), `schema` on PostgreSQL/SQL Server. */
export interface Container {
  db?: string;
  schema?: string;
}

const mysqlScope = (c: Container) => (c.db ? `'${litMy(c.db)}'` : "DATABASE()");
const pgScope = (c: Container) => (c.schema ? `'${lit(c.schema)}'` : "current_schema()");
const msScope = (c: Container) => (c.schema ? `'${lit(c.schema)}'` : "SCHEMA_NAME()");
/** SQL Server catalog views, read from another database when one is given. */
const msSys = (c: Container) => (c.db ? `${quoteIdentifier(c.db, "mssql")}.sys.` : "sys.");
const sqliteDb = (c: Container) => c.db || "main";
/** Informix: another database's catalog is `db:systables` (see foreignKeys.ts);
    only a plain identifier is used as a qualifier. */
const ifxQ = (c: Container) => (c.db && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(c.db) ? `${c.db}:` : "");
const INFORMIX_PARTS = Array.from({ length: 16 }, (_, i) => i + 1);

/** Primary key, unique and foreign-key constraints, one row per column. */
export function constraintCatalogSql(engine: string, c: Container = {}): string | null {
  switch (family(engine)) {
    case "postgres":
      return (
        "SELECT cl.relname AS table_name, con.conname AS constraint_name, " +
        "upper(con.contype::text) AS kind, a.attname AS column_name, k.i AS position, " +
        "cf.relname AS ref_table, af.attname AS ref_column " +
        "FROM pg_constraint con " +
        "JOIN pg_class cl ON cl.oid = con.conrelid " +
        "JOIN pg_namespace n ON n.oid = cl.relnamespace " +
        "JOIN generate_subscripts(con.conkey, 1) AS k(i) ON true " +
        "JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[k.i] " +
        "LEFT JOIN pg_class cf ON cf.oid = con.confrelid " +
        "LEFT JOIN pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = con.confkey[k.i] " +
        `WHERE con.contype IN ('p', 'u', 'f') AND n.nspname = ${pgScope(c)} ` +
        "ORDER BY 1, 2, 5"
      );
    case "mysql":
      return (
        "SELECT k.TABLE_NAME AS table_name, k.CONSTRAINT_NAME AS constraint_name, " +
        "CASE tc.CONSTRAINT_TYPE WHEN 'PRIMARY KEY' THEN 'P' WHEN 'UNIQUE' THEN 'U' ELSE 'F' END AS kind, " +
        "k.COLUMN_NAME AS column_name, k.ORDINAL_POSITION AS position, " +
        "k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_column " +
        "FROM information_schema.TABLE_CONSTRAINTS tc " +
        "JOIN information_schema.KEY_COLUMN_USAGE k ON k.TABLE_SCHEMA = tc.TABLE_SCHEMA " +
        "AND k.TABLE_NAME = tc.TABLE_NAME AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME " +
        `WHERE tc.TABLE_SCHEMA = ${mysqlScope(c)} ` +
        "AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY') " +
        "ORDER BY 1, 2, 5"
      );
    case "mssql": {
      const sys = msSys(c);
      const scope = `s.name = ${msScope(c)}`;
      return (
        "SELECT t.name AS table_name, kc.name AS constraint_name, " +
        "CASE kc.type WHEN 'PK' THEN 'P' ELSE 'U' END AS kind, " +
        "col.name AS column_name, ic.key_ordinal AS position, " +
        "CAST(NULL AS sysname) AS ref_table, CAST(NULL AS sysname) AS ref_column " +
        `FROM ${sys}key_constraints kc ` +
        `JOIN ${sys}tables t ON t.object_id = kc.parent_object_id ` +
        `JOIN ${sys}schemas s ON s.schema_id = t.schema_id ` +
        `JOIN ${sys}index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id ` +
        `JOIN ${sys}columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id ` +
        `WHERE ${scope} ` +
        "UNION ALL " +
        "SELECT t.name, fk.name, 'F', col.name, fkc.constraint_column_id, rt.name, rc.name " +
        `FROM ${sys}foreign_keys fk ` +
        `JOIN ${sys}tables t ON t.object_id = fk.parent_object_id ` +
        `JOIN ${sys}schemas s ON s.schema_id = t.schema_id ` +
        `JOIN ${sys}foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id ` +
        `JOIN ${sys}columns col ON col.object_id = fkc.parent_object_id AND col.column_id = fkc.parent_column_id ` +
        `JOIN ${sys}tables rt ON rt.object_id = fk.referenced_object_id ` +
        `JOIN ${sys}columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id ` +
        `WHERE ${scope} ` +
        "ORDER BY 1, 2, 5"
      );
    }
    case "sqlite": {
      // Unique constraints are the indexes SQLite created for them (origin 'u');
      // primary and foreign keys come from their pragmas. A foreign key's
      // constraint_name is the pragma id: only an identity, never a name.
      const db = sqliteDb(c);
      const m = `FROM ${quoteIdentifier(db)}.sqlite_master m`;
      const only = "WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'";
      return (
        "SELECT m.name AS table_name, NULL AS constraint_name, 'P' AS kind, p.name AS column_name, " +
        "p.pk AS position, NULL AS ref_table, NULL AS ref_column " +
        `${m} JOIN pragma_table_info(m.name, '${lit(db)}') p ${only} AND p.pk > 0 ` +
        "UNION ALL " +
        "SELECT m.name, il.name, 'U', ii.name, ii.seqno + 1, NULL, NULL " +
        `${m} JOIN pragma_index_list(m.name, '${lit(db)}') il ` +
        `JOIN pragma_index_info(il.name, '${lit(db)}') ii ${only} AND il.origin = 'u' ` +
        "UNION ALL " +
        "SELECT m.name, f.id, 'F', f.\"from\", f.seq + 1, f.\"table\", f.\"to\" " +
        `${m} JOIN pragma_foreign_key_list(m.name, '${lit(db)}') f ${only} ` +
        "ORDER BY 1, 2, 5"
      );
    }
    case "informix": {
      // Key columns are sysindexes part1..part16 (no unpivot): one branch per
      // position, as utils/foreignKeys.ts does. Parts are negative for
      // descending columns, hence ABS().
      const q = ifxQ(c);
      const branch = (n: number) =>
        "SELECT TRIM(t.tabname) AS table_name, TRIM(c.constrname) AS constraint_name, " +
        "c.constrtype AS kind, TRIM(col.colname) AS column_name, " +
        `${n} AS position, TRIM(pt.tabname) AS ref_table, TRIM(pc.colname) AS ref_column ` +
        `FROM ${q}sysconstraints c ` +
        `JOIN ${q}systables t ON t.tabid = c.tabid ` +
        `JOIN ${q}sysindexes i ON i.idxname = c.idxname AND i.tabid = c.tabid ` +
        `JOIN ${q}syscolumns col ON col.tabid = c.tabid AND col.colno = ABS(i.part${n}) ` +
        `LEFT JOIN ${q}sysreferences r ON r.constrid = c.constrid ` +
        `LEFT JOIN ${q}systables pt ON pt.tabid = r.ptabid ` +
        `LEFT JOIN ${q}sysconstraints pk ON pk.constrid = r.primary ` +
        `LEFT JOIN ${q}sysindexes pi ON pi.idxname = pk.idxname AND pi.tabid = pk.tabid ` +
        `LEFT JOIN ${q}syscolumns pc ON pc.tabid = pk.tabid AND pc.colno = ABS(pi.part${n}) ` +
        `WHERE c.constrtype IN ('P', 'U', 'R') AND t.tabid > 99 AND i.part${n} <> 0 `;
      return INFORMIX_PARTS.map(branch).join("UNION ALL ") + "ORDER BY 1, 2, 5";
    }
    default:
      return null;
  }
}

/** CHECK constraints. Null where there is no catalog for them: SQLite keeps
    them only in the CREATE TABLE text, Informix in chunked syschecks text. */
export function checkCatalogSql(engine: string, c: Container = {}): string | null {
  switch (family(engine)) {
    case "postgres":
      return (
        "SELECT cl.relname AS table_name, con.conname AS constraint_name, " +
        "pg_get_constraintdef(con.oid) AS definition " +
        "FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid " +
        "JOIN pg_namespace n ON n.oid = cl.relnamespace " +
        `WHERE con.contype = 'c' AND n.nspname = ${pgScope(c)} ORDER BY 1, 2`
      );
    case "mysql":
      // CHECK_CONSTRAINTS exists from MySQL 8.0.16 / MariaDB 10.2; older servers
      // fail this query and CHECKs are then reported as not compared.
      return (
        "SELECT tc.TABLE_NAME AS table_name, cc.CONSTRAINT_NAME AS constraint_name, " +
        "cc.CHECK_CLAUSE AS definition " +
        "FROM information_schema.TABLE_CONSTRAINTS tc " +
        "JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA " +
        "AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME " +
        `WHERE tc.TABLE_SCHEMA = ${mysqlScope(c)} AND tc.CONSTRAINT_TYPE = 'CHECK' ORDER BY 1, 2`
      );
    case "mssql": {
      const sys = msSys(c);
      return (
        "SELECT t.name AS table_name, cc.name AS constraint_name, cc.definition AS definition " +
        `FROM ${sys}check_constraints cc ` +
        `JOIN ${sys}tables t ON t.object_id = cc.parent_object_id ` +
        `JOIN ${sys}schemas s ON s.schema_id = t.schema_id ` +
        `WHERE s.name = ${msScope(c)} ORDER BY 1, 2`
      );
    }
    default:
      return null;
  }
}

/** Plain indexes (not backing a primary key or unique constraint). */
export function indexCatalogSql(engine: string, c: Container = {}): string | null {
  switch (family(engine)) {
    case "postgres":
      return (
        "SELECT t.relname AS table_name, i.relname AS index_name, " +
        "CASE WHEN ix.indisunique THEN 1 ELSE 0 END AS is_unique, " +
        "a.attname AS column_name, k.i AS position, " +
        "CASE WHEN ix.indpred IS NOT NULL OR ix.indexprs IS NOT NULL OR am.amname <> 'btree' " +
        "THEN 1 ELSE 0 END AS special " +
        "FROM pg_index ix " +
        "JOIN pg_class i ON i.oid = ix.indexrelid " +
        "JOIN pg_class t ON t.oid = ix.indrelid " +
        "JOIN pg_namespace n ON n.oid = t.relnamespace " +
        "JOIN pg_am am ON am.oid = i.relam " +
        "JOIN generate_series(1, ix.indnkeyatts) AS k(i) ON true " +
        "LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ix.indkey[k.i - 1] " +
        `WHERE n.nspname = ${pgScope(c)} AND t.relkind IN ('r', 'p') ` +
        "AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid " +
        "AND con.contype IN ('p', 'u', 'x')) " +
        "ORDER BY 1, 2, 5"
      );
    case "mysql":
      // Unique indexes are UNIQUE constraints in MySQL (read with the
      // constraints), so only non-unique ones are listed here.
      return (
        "SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, 0 AS is_unique, " +
        "COLUMN_NAME AS column_name, SEQ_IN_INDEX AS position, " +
        "CASE WHEN COLUMN_NAME IS NULL OR SUB_PART IS NOT NULL " +
        "OR INDEX_TYPE NOT IN ('BTREE', 'HASH') THEN 1 ELSE 0 END AS special " +
        "FROM information_schema.STATISTICS " +
        `WHERE TABLE_SCHEMA = ${mysqlScope(c)} AND NON_UNIQUE = 1 ORDER BY 1, 2, 5`
      );
    case "mssql": {
      const sys = msSys(c);
      // ponytail: INCLUDE columns (key_ordinal 0) are not compared.
      return (
        "SELECT t.name AS table_name, i.name AS index_name, CAST(i.is_unique AS int) AS is_unique, " +
        "col.name AS column_name, ic.key_ordinal AS position, " +
        "CASE WHEN i.has_filter = 1 OR i.type <> 2 THEN 1 ELSE 0 END AS special " +
        `FROM ${sys}indexes i ` +
        `JOIN ${sys}tables t ON t.object_id = i.object_id ` +
        `JOIN ${sys}schemas s ON s.schema_id = t.schema_id ` +
        `JOIN ${sys}index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0 ` +
        `JOIN ${sys}columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id ` +
        `WHERE s.name = ${msScope(c)} AND i.is_primary_key = 0 AND i.is_unique_constraint = 0 AND i.type > 0 ` +
        "ORDER BY 1, 2, 5"
      );
    }
    case "sqlite": {
      const db = sqliteDb(c);
      return (
        "SELECT m.name AS table_name, il.name AS index_name, il.\"unique\" AS is_unique, " +
        "ii.name AS column_name, ii.seqno + 1 AS position, " +
        "CASE WHEN il.partial = 1 OR ii.name IS NULL THEN 1 ELSE 0 END AS special " +
        `FROM ${quoteIdentifier(db)}.sqlite_master m ` +
        `JOIN pragma_index_list(m.name, '${lit(db)}') il ` +
        `JOIN pragma_index_info(il.name, '${lit(db)}') ii ` +
        "WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND il.origin = 'c' " +
        "ORDER BY 1, 2, 5"
      );
    }
    case "informix": {
      const q = ifxQ(c);
      const branch = (n: number) =>
        "SELECT TRIM(t.tabname) AS table_name, TRIM(i.idxname) AS index_name, " +
        "CASE WHEN i.idxtype = 'U' THEN 1 ELSE 0 END AS is_unique, " +
        `TRIM(col.colname) AS column_name, ${n} AS position, 0 AS special ` +
        `FROM ${q}sysindexes i ` +
        `JOIN ${q}systables t ON t.tabid = i.tabid ` +
        `JOIN ${q}syscolumns col ON col.tabid = i.tabid AND col.colno = ABS(i.part${n}) ` +
        `WHERE t.tabid > 99 AND t.tabtype = 'T' AND i.part${n} <> 0 ` +
        `AND NOT EXISTS (SELECT 1 FROM ${q}sysconstraints c WHERE c.tabid = i.tabid AND c.idxname = i.idxname) `;
      return INFORMIX_PARTS.map(branch).join("UNION ALL ") + "ORDER BY 1, 2, 5";
    }
    default:
      return null;
  }
}

/** Rows of a result as objects keyed by lower-cased column name. */
function records(rs: ResultSet): Record<string, string | null>[] {
  const names = rs.columns.map((c) => c.name.toLowerCase());
  return rs.rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? null])));
}

/** Group records by a key, keeping first-seen order, each group sorted by position. */
function groups(
  rows: Record<string, string | null>[],
  key: (r: Record<string, string | null>) => string,
): Record<string, string | null>[][] {
  const by = new Map<string, Record<string, string | null>[]>();
  for (const r of rows) {
    const g = by.get(key(r));
    if (g) g.push(r);
    else by.set(key(r), [r]);
  }
  return [...by.values()].map((g) => g.sort((a, b) => Number(a.position) - Number(b.position)));
}

const trim = (v: string | null) => (v ?? "").trim();

/**
 * Fill `tables` (keyed by lower-cased name) with the keys of a constraints
 * result. Every table's primary key is replaced by the catalog's, which knows
 * the key's name and column order (describe only flags the columns). SQLite's
 * names are pragma ids or autoindex names and MySQL calls every key PRIMARY:
 * those are dropped so the script does not reuse them.
 */
export function applyConstraints(tables: Map<string, TableDef>, engine: string, rs: ResultSet): void {
  const sqlite = family(engine) === "sqlite";
  for (const t of tables.values()) t.primaryKey = null;
  const rows = records(rs);
  for (const g of groups(rows, (r) => `${trim(r.table_name)}\u0000${trim(r.kind)}\u0000${trim(r.constraint_name)}`)) {
    const first = g[0];
    const table = tables.get(trim(first.table_name).toLowerCase());
    if (!table) continue;
    const raw = trim(first.constraint_name);
    const name = sqlite || raw === "" || raw === "PRIMARY" ? undefined : raw;
    const columns = g.map((r) => trim(r.column_name));
    const kind = trim(first.kind).toUpperCase();
    if (kind === "P") table.primaryKey = { name, columns };
    else if (kind === "U") table.uniques.push({ name, columns });
    else if (kind === "F" || kind === "R") {
      table.foreignKeys.push({
        name,
        columns,
        refTable: trim(first.ref_table),
        refColumns: g.map((r) => trim(r.ref_column)),
      });
    }
  }
  // SQLite leaves the referenced column out when the key points at the parent's
  // primary key (`REFERENCES parent`); fill it in, the script needs it spelled.
  for (const t of tables.values()) {
    for (const fk of t.foreignKeys) {
      if (fk.refColumns.some((c) => c === "")) {
        const pk = tables.get(fk.refTable.toLowerCase())?.primaryKey?.columns;
        if (pk && pk.length === fk.columns.length) fk.refColumns = [...pk];
      }
    }
  }
}

/** Fill tables with the CHECK constraints of a checks result. PostgreSQL's
    definition carries the CHECK keyword; it is stripped to the expression. */
export function applyChecks(tables: Map<string, TableDef>, rs: ResultSet): void {
  for (const r of records(rs)) {
    const table = tables.get(trim(r.table_name).toLowerCase());
    if (!table) continue;
    const name = trim(r.constraint_name) || undefined;
    table.checks.push({ name, expr: trim(r.definition).replace(/^check\s*/i, "") });
  }
}

/** Fill tables with the indexes of an indexes result; returns the indexes left
    out of the comparison ("table.index"). */
export function applyIndexes(tables: Map<string, TableDef>, rs: ResultSet): string[] {
  const skipped: string[] = [];
  for (const g of groups(records(rs), (r) => `${trim(r.table_name)}\u0000${trim(r.index_name)}`)) {
    const first = g[0];
    const table = tables.get(trim(first.table_name).toLowerCase());
    if (!table) continue;
    const name = trim(first.index_name);
    if (g.some((r) => trim(r.special) === "1" || trim(r.column_name) === "")) {
      skipped.push(`${table.name}.${name}`);
      continue;
    }
    table.indexes.push({ name, columns: g.map((r) => trim(r.column_name)), unique: trim(first.is_unique) === "1" });
  }
  return skipped;
}

/**
 * MySQL's COLUMN_DEFAULT is the bare value — `abc`, not `'abc'` — so a string
 * default is quoted to be usable in DDL. Numbers, NULL, b'…'/x'…' literals,
 * already-quoted values (MariaDB) and functions (CURRENT_TIMESTAMP, uuid()) are
 * kept. ponytail: a string default that looks like a number or a function is
 * mistaken for one; EXTRA's DEFAULT_GENERATED would tell them apart.
 */
export function mysqlDefault(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (/^null$/i.test(v)) return null;
  if (
    /^-?\d+(\.\d+)?$/.test(v) ||
    /^[bx]?'/i.test(v) ||
    /^(current_timestamp|current_date|current_time|localtime|localtimestamp|now)\b/i.test(v) ||
    /^\w+\(.*\)$/.test(v) ||
    v.startsWith("(")
  ) {
    return v;
  }
  return `'${raw.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/** The I/O one side needs, injected so readSnapshot is testable. The wizard
    wires these to schema.tree/describe/ddl and a drained query.run. */
export interface SnapshotSource {
  engine: string;
  container: Container;
  tree(): Promise<ResultSet>;
  describe(table: string): Promise<ResultSet>;
  ddl(view: string): Promise<string>;
  query(sql: string): Promise<ResultSet>;
}

/** The chosen container lists databases or schemas, not tables. */
export class NotATableListError extends Error {
  constructor() {
    super("the selected container lists databases or schemas, not tables");
    this.name = "NotATableListError";
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)) || "error";

/**
 * Read one side into a snapshot. A failing tree or describe rejects (nothing can
 * be compared without the tables); a failing or absent catalog only marks its
 * category missing.
 */
export async function readSnapshot(src: SnapshotSource): Promise<SchemaSnapshot> {
  const f = family(src.engine);
  const missing: Partial<Record<Category, string>> = {};
  if (f === "mongodb") {
    // generateMigration refuses MongoDB outright; reading it is pointless.
    return { engine: src.engine, tables: [], views: [], missing, skipped: [] };
  }
  const tree = await src.tree();
  if (!tree.columns.some((c) => c.name === "type")) throw new NotATableListError();
  const rows = parseTreeRows(tree, "schema");

  const tables: TableDef[] = [];
  for (const r of rows.filter((x) => x.kind === "table")) {
    const columns = parseStructure(await src.describe(r.name));
    if (f === "mysql") for (const c of columns) c.dflt = mysqlDefault(c.dflt);
    const pk = columns.filter((c) => c.pk).map((c) => c.name);
    tables.push({
      name: r.name,
      columns,
      primaryKey: pk.length > 0 ? { columns: pk } : null,
      uniques: [],
      indexes: [],
      foreignKeys: [],
      checks: [],
    });
  }
  // Informix's describe has no default (dflt_value is always NULL).
  if (f === "informix") missing.defaults = "";

  const byName = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  let skipped: string[] = [];
  const read = async (category: Category, sql: string | null, apply: (rs: ResultSet) => void) => {
    if (!sql) {
      missing[category] = "";
      return;
    }
    try {
      apply(await src.query(sql));
    } catch (err) {
      missing[category] = errText(err);
    }
  };
  await read("constraints", constraintCatalogSql(src.engine, src.container), (rs) =>
    applyConstraints(byName, src.engine, rs),
  );
  await read("checks", checkCatalogSql(src.engine, src.container), (rs) => applyChecks(byName, rs));
  await read("indexes", indexCatalogSql(src.engine, src.container), (rs) => {
    skipped = applyIndexes(byName, rs);
  });

  const views: ViewDef[] = [];
  try {
    for (const r of rows.filter((x) => x.kind === "view")) {
      const ddl = (await src.ddl(r.name)).trim();
      if (!ddl) throw new Error(`no definition for view ${r.name}`);
      views.push({ name: r.name, ddl });
    }
  } catch (err) {
    missing.views = errText(err);
    views.length = 0;
  }

  return { engine: src.engine, tables, views, missing, skipped };
}
