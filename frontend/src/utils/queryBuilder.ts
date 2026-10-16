// Pure SQL predicate building, shared by two callers with different shapes:
// the visual query builder (issue #146), which composes a whole SELECT through
// buildSelect, and the data tab's filter panel (issue #347), which needs only the
// WHERE and ORDER BY bodies to hand to previewSelect. One implementation, so the
// two cannot disagree about what "contains" means.
//
// Identifiers are quoted per engine. Values are quoted as strings unless the
// column's declared type is known and numeric -- see sqlLiteral, which is also
// what the related-data modal builds its filters with.

import { classifyType } from "./format";
import { quoteIdentifier, qualifiedName } from "./schema";

export type Operator =
  | "="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "LIKE"
  | "CONTAINS"
  | "STARTS_WITH"
  | "BETWEEN"
  | "IN"
  | "IS NULL"
  | "IS NOT NULL";

export const OPERATORS: Operator[] = [
  "=", "!=", "<", ">", "<=", ">=", "LIKE", "CONTAINS", "STARTS_WITH", "BETWEEN", "IN",
  "IS NULL", "IS NOT NULL",
];

/** An operator that takes no value on the right-hand side. */
export function isNullaryOp(op: Operator): boolean {
  return op === "IS NULL" || op === "IS NOT NULL";
}

/** An operator whose value is two values: `a … b` (issue #347). */
export function isRangeOp(op: Operator): boolean {
  return op === "BETWEEN";
}

/** How a BETWEEN row's two bounds travel inside one `value` string. */
export const RANGE_SEPARATOR = "…";

export interface Condition {
  column: string;
  op: Operator;
  value: string;
  /**
   * Unchecked rows keep their criteria but stay out of the WHERE (issue #347).
   * Trying a hypothesis without losing what you wrote is half of what a filter
   * panel is for. Undefined means active, so the query builder that predates
   * this does not have to set it.
   */
  enabled?: boolean;
  /**
   * How this condition joins the one before it (issue #646). Undefined falls
   * back to the caller's list-wide conjunction; ignored on the first condition.
   */
  join?: "AND" | "OR";
}

export interface OrderBy {
  column: string;
  dir: "ASC" | "DESC";
}

export interface QuerySpec {
  table: string;
  /** Optional db/schema qualifier for the table name. */
  container?: string;
  /** Selected columns; empty => SELECT *. */
  columns: string[];
  conditions: Condition[];
  /** How the conditions combine. */
  conjunction: "AND" | "OR";
  orderBy?: OrderBy | null;
  limit?: number | null;
  /** Declared column types, when known: numbers then go unquoted. */
  types?: ColumnTypes;
}

/**
 * A SQL literal for `value`. Without a declared `type` everything is quoted as a
 * string, which is what this builder always did and what engines coerce for a
 * scalar comparison. WITH one, a numeric column gets an unquoted number — which
 * starts to matter in a long `IN` list, and matters to the plan: a quoted literal
 * against an integer column can cost the index.
 */
export function sqlLiteral(value: string, type?: string): string {
  if (type !== undefined && classifyType(type) === "number" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return value.trim();
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Declared type per column name, as `schema.describe` reports it. */
export type ColumnTypes = Record<string, string>;

/** The declared type of `column`, matched case-insensitively as catalogs vary. */
function typeOf(types: ColumnTypes | undefined, column: string): string | undefined {
  if (!types) return undefined;
  const hit = Object.keys(types).find((k) => k.toLowerCase() === column.toLowerCase());
  return hit === undefined ? undefined : types[hit];
}

/** Render one WHERE condition to SQL (empty string if the column is blank). */
function renderCondition(engine: string, c: Condition, types?: ColumnTypes): string {
  if (!c.column.trim()) return "";
  const col = quoteIdentifier(c.column, engine);
  const lit = (v: string) => sqlLiteral(v, typeOf(types, c.column));
  if (isNullaryOp(c.op)) return `${col} ${c.op}`;
  if (c.op === "IN") {
    const items = c.value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(lit);
    if (items.length === 0) return "";
    return `${col} IN (${items.join(", ")})`;
  }
  if (c.op === "CONTAINS" || c.op === "STARTS_WITH") {
    // Always a string comparison: the pattern is text even over a number column.
    if (!c.value.trim()) return "";
    const lead = c.op === "CONTAINS" ? "%" : "";
    return `${col} LIKE ${sqlLiteral(`${lead}${c.value}%`)}`;
  }
  if (c.op === "BETWEEN") {
    const [from, to] = c.value.split(RANGE_SEPARATOR).map((s) => s.trim());
    if (!from || !to) return ""; // half a range is not a filter
    return `${col} BETWEEN ${lit(from)} AND ${lit(to)}`;
  }
  return `${col} ${c.op} ${lit(c.value)}`;
}

/**
 * The WHERE body (no keyword) for `conditions`, or "" when none of them says
 * anything. Unchecked rows and rows that render to nothing are dropped, which is
 * what lets the panel hold an unfinished criterion without breaking the query.
 *
 * Each condition joins the previous one with its own `join`, or `conjunction`
 * when it has none (issue #646). AND binds tighter than OR, as in SQL, and each
 * AND-run is parenthesised when ORs are mixed in, so the text says what the
 * panel shows: `a AND b OR c` renders `(a AND b) OR c`.
 */
export function renderWhere(
  engine: string,
  conditions: Condition[],
  conjunction: "AND" | "OR" = "AND",
  types?: ColumnTypes,
): string {
  const groups: string[][] = [];
  for (const c of conditions) {
    if (c.enabled === false) continue;
    const sql = renderCondition(engine, c, types);
    if (!sql) continue;
    if (groups.length === 0 || (c.join ?? conjunction) === "OR") groups.push([sql]);
    else groups[groups.length - 1].push(sql);
  }
  if (groups.length === 1) return groups[0].join(" AND ");
  return groups
    .map((g) => (g.length > 1 ? `(${g.join(" AND ")})` : g[0]))
    .join(" OR ");
}

/** The ORDER BY body (no keyword) for `order`, or "" when it says nothing. */
export function renderOrderBy(engine: string, order: OrderBy[]): string {
  return order
    .filter((o) => o.column.trim().length > 0)
    .map((o) => `${quoteIdentifier(o.column, engine)} ${o.dir}`)
    .join(", ");
}

/**
 * Build a SELECT statement from the spec. Empty `columns` yields `SELECT *`; the
 * table is qualified with `container` when present; conditions with a blank
 * column (or an empty IN list) are dropped. Returns "" when there is no table.
 */
export function buildSelect(engine: string, spec: QuerySpec): string {
  if (!spec.table.trim()) return "";
  const cols =
    spec.columns.length === 0
      ? "*"
      : spec.columns.map((c) => quoteIdentifier(c, engine)).join(", ");
  const name = qualifiedName({ db: spec.container, name: spec.table }, engine);

  let sql = `SELECT ${cols} FROM ${name}`;

  const where = renderWhere(engine, spec.conditions, spec.conjunction, spec.types);
  if (where) {
    sql += ` WHERE ${where}`;
  }

  const order = renderOrderBy(engine, spec.orderBy ? [spec.orderBy] : []);
  if (order) {
    sql += ` ORDER BY ${order}`;
  }

  if (spec.limit != null && spec.limit > 0) {
    sql += ` LIMIT ${Math.floor(spec.limit)}`;
  }

  return sql + ";";
}

/** A fresh empty condition row. */
export function emptyCondition(): Condition {
  return { column: "", op: "=", value: "" };
}
