// Build the table -> columns map that feeds the SQL editor's autocomplete
// (issue #110). The pure `buildSqlSchema` shapes fetched data into the form
// @codemirror/lang-sql wants; `loadCompletionSchema` walks the object tree
// (bounded) and describes tables to gather it. Best-effort and lazy: it runs in
// the background, skips tables that fail, and caps how many it fetches so a huge
// database never stalls typing.

import { schemaTree, schemaDescribe, parseTreeRows } from "./schema";

/** Shape a list of (table, columns) into lang-sql's schema map. */
export function buildSqlSchema(
  entries: { table: string; columns: string[] }[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of entries) {
    if (e.table) out[e.table] = e.columns;
  }
  return out;
}

/** Extract the `name` column values from a schema.describe result set. */
function columnNames(desc: { columns: { name: string }[]; rows: (string | null)[][] }): string[] {
  const idx = desc.columns.findIndex((c) => c.name === "name");
  if (idx === -1) return [];
  return desc.rows.map((r) => r[idx]).filter((v): v is string => !!v);
}

/**
 * Walk the object tree of `connId` (databases → schemas → tables, mirroring the
 * sidebar) up to `maxTables`, describe each table, and return a table→columns
 * map for the editor. Never throws: any failure yields an empty/partial map.
 */
export async function loadCompletionSchema(
  connId: string,
  maxTables = 40,
): Promise<Record<string, string[]>> {
  const targets: { table: string; db?: string; schema?: string }[] = [];
  try {
    const level0 = parseTreeRows(await schemaTree(connId), "database");
    for (const n0 of level0) {
      if (targets.length >= maxTables) break;
      if (n0.kind === "table" || n0.kind === "view") {
        targets.push({ table: n0.name });
        continue;
      }
      const level1 = parseTreeRows(await schemaTree(connId, n0.name), "schema");
      for (const n1 of level1) {
        if (targets.length >= maxTables) break;
        if (n1.kind === "table" || n1.kind === "view") {
          targets.push({ table: n1.name, db: n0.name });
          continue;
        }
        const level2 = parseTreeRows(await schemaTree(connId, n0.name, n1.name), "schema");
        for (const n2 of level2) {
          if (targets.length >= maxTables) break;
          targets.push({ table: n2.name, db: n0.name, schema: n1.name });
        }
      }
    }
  } catch {
    return {};
  }

  const entries: { table: string; columns: string[] }[] = [];
  for (const t of targets) {
    try {
      const desc = await schemaDescribe(connId, t.table, t.db, t.schema);
      entries.push({ table: t.table, columns: columnNames(desc) });
    } catch {
      /* skip a table that fails to describe */
    }
  }
  return buildSqlSchema(entries);
}
