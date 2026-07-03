#ifndef QUAERO_SQLITE_DML_H
#define QUAERO_SQLITE_DML_H

#include "dbcore/driver.h"

/*
 * Build the literal SQL for a single-row modification (issue #26/#27): an
 * INSERT, UPDATE or DELETE against `row->table` (optionally schema-qualified).
 * Identifiers are double-quoted (embedded quotes doubled) and values are inlined
 * as single-quoted string literals (embedded quotes doubled), or the NULL
 * keyword for a NULL value; the engine coerces the literal to the column's type.
 * A WHERE term whose value is NULL is rendered as `IS NULL`.
 *
 * Returns a freshly allocated SQL string (free with free()), or NULL when the
 * request is invalid — no table; INSERT/UPDATE with no columns to set;
 * UPDATE/DELETE with no WHERE columns (refusing to touch every row) — or on OOM.
 *
 * Pure: it depends only on the neutral dbc_dml_row, so it is unit-tested without
 * a live SQLite database.
 */
char *sqlite_build_dml_sql(dbc_dml_kind kind, const dbc_dml_row *row);

#endif /* QUAERO_SQLITE_DML_H */
