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

#include <stddef.h>

/*
 * Fit the text of a DATETIME value to its column's qualifier (issue #599).
 * Over DRDA every DATETIME YEAR TO ... reads as a DRDA TIMESTAMP, always with
 * six decimals ("2026-09-23 10:00:00.000000"), and Informix refuses that text
 * back in a column that ends sooner (-1264, "extra characters at the end of a
 * datetime"). `collength` is syscolumns.collength, whose low byte encodes the
 * qualifier (largest field * 16 + smallest; YEAR 0, MONTH 2, DAY 4, HOUR 6,
 * MINUTE 8, SECOND 10, FRACTION(n) 10 + n). "YYYY-MM-DD HH:MM:SS[.f]",
 * "YYYY-MM-DD" and "HH:MM:SS[.f]" are recognised; the fields the qualifier
 * names are kept, FRACTION cut or padded to its scale.
 *
 * Writes the fitted text into out and returns 1; returns 0 (out untouched)
 * when the value is not one of those forms, does not cover the qualifier's
 * fields, or out is too small: such a value goes to the server as typed.
 */
int informix_fit_datetime(const char *val, int collength, char *out, size_t cap);

#endif /* QUAERO_INFORMIX_DML_H */
