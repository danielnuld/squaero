// Pure SELECT builder for the visual query builder (issue #146). The component
// collects a table, columns, WHERE conditions, ORDER BY and LIMIT into a
// QuerySpec; buildSelect renders it to SQL with per-engine identifier quoting and
// single-quoted string literals. Values are always quoted as strings (engines
// coerce for numeric comparisons) except NULL checks (no value) and IN (a
// comma-separated list). All pure and unit-tested; the component just runs the
// SQL this returns.

import { quoteIdentifier, qualifiedName } from "./schema";

export type Operator =
  | "="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "LIKE"
  | "IN"
  | "IS NULL"
  | "IS NOT NULL";

export const OPERATORS: Operator[] = [
  "=", "!=", "<", ">", "<=", ">=", "LIKE", "IN", "IS NULL", "IS NOT NULL",
];

/** An operator that takes no value on the right-hand side. */
export function isNullaryOp(op: Operator): boolean {
  return op === "IS NULL" || op === "IS NOT NULL";
}

export interface Condition {
  column: string;
  op: Operator;
  value: string;
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
}

/** Single-quote a SQL string literal, doubling embedded quotes. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Render one WHERE condition to SQL (empty string if the column is blank). */
function renderCondition(engine: string, c: Condition): string {
  if (!c.column.trim()) return "";
  const col = quoteIdentifier(c.column, engine);
  if (isNullaryOp(c.op)) return `${col} ${c.op}`;
  if (c.op === "IN") {
    const items = c.value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(literal);
    if (items.length === 0) return "";
    return `${col} IN (${items.join(", ")})`;
  }
  return `${col} ${c.op} ${literal(c.value)}`;
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

  const where = spec.conditions
    .map((c) => renderCondition(engine, c))
    .filter((s) => s.length > 0);
  if (where.length > 0) {
    sql += ` WHERE ${where.join(` ${spec.conjunction} `)}`;
  }

  if (spec.orderBy && spec.orderBy.column.trim()) {
    sql += ` ORDER BY ${quoteIdentifier(spec.orderBy.column, engine)} ${spec.orderBy.dir}`;
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
