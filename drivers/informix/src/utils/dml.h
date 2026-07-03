#ifndef QUAERO_INFORMIX_DML_H
#define QUAERO_INFORMIX_DML_H

#include "dbcore/driver.h"

/*
 * Build the literal SQL for a single-row modification (issue #26/#27): an
 * INSERT, UPDATE or DELETE against `row->table`. A non-empty `row->schema` names
 * the database and is applied as Informix's `database:table` qualifier (the same
 * convention metadata.c uses for cross-database catalog access).
 *
 * Identifiers are emitted UNQUOTED: without DELIMIDENT enabled, Informix reads
 * double-quoted text as a string literal rather than a delimited identifier, so
 * quoting would be actively wrong on a default connection. Plain identifiers
 * work regardless; names that are reserved words or contain unusual characters
 * are the documented limitation. Values are single-quoted literals with embedded
 * quotes doubled (Informix does not treat backslash specially in a string), or
 * the NULL keyword; a WHERE term whose value is NULL becomes `IS NULL`.
 *
 * Returns a freshly allocated SQL string (free with free()), or NULL for an
 * invalid request — no table; INSERT/UPDATE with no columns; UPDATE/DELETE with
 * no WHERE columns (refusing to touch every row) — or on OOM.
 *
 * Pure: depends only on the neutral dbc_dml_row, unit-tested without Informix.
 */
char *informix_build_dml_sql(dbc_dml_kind kind, const dbc_dml_row *row);

#endif /* QUAERO_INFORMIX_DML_H */
