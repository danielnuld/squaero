// mongosh statements for the tools that run SQL on the other engines: the tree's
// collection management (#719), the index manager, the server monitor, the
// slow-queries tool and the execution plan. MongoDB has no SQL, but the driver
// runs the mongosh surface (docs/MONGODB.md), so each tool builds the statement
// it needs and runs it through query.run like any other. Pure and unit-tested;
// every name goes through JSON string quoting, which is a valid mongosh string
// literal, so a name can never break out of its statement.

/** `db.name` for a plain identifier, else `db.getCollection("name")`. */
export function mongoCollRef(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name)
    ? `db.${name}`
    : `db.getCollection(${JSON.stringify(name)})`;
}

/** Drop a collection or a view. */
export function mongoDropSql(name: string): string {
  return `${mongoCollRef(name)}.drop()`;
}

/** Delete every document, keeping the collection (and its indexes). */
export function mongoEmptySql(name: string): string {
  return `${mongoCollRef(name)}.deleteMany({})`;
}

/**
 * Rename a collection. Null when the new name cannot be one: empty, unchanged,
 * containing `$` or a NUL, or in the reserved `system.` namespace. The server
 * has the last word (a name already taken is its error, not ours).
 */
export function mongoRenameSql(name: string, newName: string): string | null {
  const target = newName.trim();
  if (!target || target === name) return null;
  if (/[$\0]/.test(target) || target.startsWith("system.")) return null;
  return `${mongoCollRef(name)}.renameCollection(${JSON.stringify(target)})`;
}

/** The indexes of a collection, one row per index (name, key, unique, …). */
export function mongoIndexListSql(table: string): string {
  return `${mongoCollRef(table)}.getIndexes()`;
}

/** createIndex on ascending keys, with the index name and the unique flag. */
export function mongoCreateIndexSql(
  table: string,
  name: string,
  columns: string[],
  unique: boolean,
): string {
  const keys = columns.map((c) => `${JSON.stringify(c)}: 1`).join(", ");
  const opts = `{"name": ${JSON.stringify(name)}${unique ? ', "unique": true' : ""}}`;
  return `${mongoCollRef(table)}.createIndex({${keys}}, ${opts})`;
}

export function mongoDropIndexSql(table: string, name: string): string {
  return `${mongoCollRef(table)}.dropIndex(${JSON.stringify(name)})`;
}

/**
 * The statement that kills an operation, from the `opid` of the monitor's row.
 * A standalone server or replica set numbers operations with integers; a sharded
 * cluster uses "<shard>:<number>", which is passed as a string. Anything else is
 * refused (null) so the id can never carry anything into the statement.
 */
export function mongoKillSql(id: string): string | null {
  const v = id.trim();
  if (/^\d+$/.test(v)) return `db.killOp(${v})`;
  if (/^[\w.-]+:\d+$/.test(v)) return `db.killOp(${JSON.stringify(v)})`;
  return null;
}

/** The statement for a profile entry's `ns` ("db.coll") — the collection part. */
function collectionOfNs(ns: string): string | null {
  const dot = ns.indexOf(".");
  const coll = dot >= 0 ? ns.slice(dot + 1) : "";
  return coll && !coll.startsWith("system.") ? coll : null;
}

const compact = (v: unknown) => JSON.stringify(v);

/**
 * Rebuild the mongosh statement of a profiled operation (`system.profile`
 * `command`, as the grid shows it: Extended JSON) so the slow-queries tool can
 * open it in the editor or explain it. Reads only: find, aggregate, count and
 * distinct. Null for the rest (writes and other commands) — the tool then offers
 * nothing rather than a statement that is not what ran.
 */
export function mongoStatementFromProfile(ns: string, commandJson: string): string | null {
  const coll = collectionOfNs(ns);
  if (!coll) return null;
  let cmd: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(commandJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    cmd = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const ref = mongoCollRef(coll);
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  if ("find" in cmd) {
    let sql = `${ref}.find(${compact(obj(cmd.filter))}`;
    if (cmd.projection && typeof cmd.projection === "object") sql += `, ${compact(cmd.projection)}`;
    sql += ")";
    if (cmd.sort && typeof cmd.sort === "object") sql += `.sort(${compact(cmd.sort)})`;
    if (typeof cmd.skip === "number" && cmd.skip > 0) sql += `.skip(${cmd.skip})`;
    if (typeof cmd.limit === "number" && cmd.limit > 0) sql += `.limit(${cmd.limit})`;
    return sql;
  }
  if ("aggregate" in cmd && Array.isArray(cmd.pipeline)) {
    return `${ref}.aggregate(${compact(cmd.pipeline)})`;
  }
  if ("count" in cmd) {
    return `${ref}.countDocuments(${compact(obj(cmd.query))})`;
  }
  if ("distinct" in cmd && typeof cmd.key === "string") {
    return `${ref}.distinct(${JSON.stringify(cmd.key)}, ${compact(obj(cmd.query))})`;
  }
  return null;
}

/**
 * The statement to run for an execution plan: the user's find/aggregate with a
 * trailing `.explain("queryPlanner")` (the plan only; it does not run the query).
 * A statement that already ends in `.explain(...)` is kept; `findOne(...)` becomes
 * a `find(...).limit(1)`, which is what it runs. Null when it is not a statement
 * on a collection at all.
 */
export function mongoExplainStatement(sql: string): string | null {
  const q = sql.trim().replace(/;\s*$/, "");
  if (!q.startsWith("db.")) return null;
  if (/\.explain\([^)]*\)$/.test(q)) return q;
  if (/\.findOne\(/.test(q)) {
    const rewritten = q.replace(/\.findOne\(/, ".find(");
    return `${rewritten}.limit(1).explain("queryPlanner")`;
  }
  return `${q}.explain("queryPlanner")`;
}
