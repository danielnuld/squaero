#ifndef QUAERO_MYSQL_DML_H
#define QUAERO_MYSQL_DML_H

#include "dbcore/driver.h"

/*
 * Build the literal SQL for a single-row modification (issue #26/#27): an
 * INSERT, UPDATE or DELETE against `row->table` (optionally schema-qualified).
 * Identifiers are backtick-quoted (embedded backticks doubled) and values are
 * inlined as single-quoted literals with MySQL escaping (`'` -> `\'`, `\` ->
 * `\\`), or the NULL keyword; a WHERE term whose value is NULL becomes `IS NULL`.
 *
 * Returns a freshly allocated SQL string (free with free()), or NULL for an
 * invalid request — no table; INSERT/UPDATE with no columns; UPDATE/DELETE with
 * no WHERE columns (refusing to touch every row) — or on OOM.
 *
 * Pure: it depends only on the neutral dbc_dml_row, so it is unit-tested without
 * a live MySQL server. Escaping targets the default SQL mode (backslash escapes
 * enabled); it does not consult the connection charset.
 */
char *mysql_build_dml_sql(dbc_dml_kind kind, const dbc_dml_row *row);

#endif /* QUAERO_MYSQL_DML_H */
