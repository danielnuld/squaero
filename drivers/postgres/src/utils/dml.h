#ifndef QUAERO_POSTGRES_DML_H
#define QUAERO_POSTGRES_DML_H

#include "dbcore/driver.h"

/*
 * Build the literal SQL for a single-row modification (issue #26/#27): an
 * INSERT, UPDATE or DELETE against `row->table` (optionally schema-qualified).
 * Identifiers are double-quoted (embedded double quotes doubled) and values are
 * inlined as single-quoted literals with standard SQL escaping (`'` -> `''`), or
 * the NULL keyword; a WHERE term whose value is NULL becomes `IS NULL`.
 *
 * Returns a freshly allocated SQL string (free with free()), or NULL for an
 * invalid request — no table; INSERT/UPDATE with no columns; UPDATE/DELETE with
 * no WHERE columns (refusing to touch every row) — or on OOM.
 *
 * Pure: it depends only on the neutral dbc_dml_row, so it is unit-tested without
 * a live PostgreSQL server. Escaping relies on standard_conforming_strings being
 * on (the default since PostgreSQL 9.1): a backslash is an ordinary character
 * and only the single quote needs doubling.
 */
char *pg_build_dml_sql(dbc_dml_kind kind, const dbc_dml_row *row);

#endif /* QUAERO_POSTGRES_DML_H */
