#ifndef DBCORE_RESULT_H
#define DBCORE_RESULT_H

/*
 * Neutral, engine-agnostic result-set model. A dbcore_result is materialized by
 * dbcore_query_run (see dbcore/query.h) from a driver's raw result and owns all
 * its data: column names, neutral column types, and the cell values of the rows
 * that were fetched.
 *
 * Cells are stored as text (the wire form crossing to the frontend in #10); a
 * SQL NULL is represented distinctly from an empty string. A statement that
 * produces no result set (INSERT/UPDATE/DDL) has zero columns and reports
 * rows_affected instead — see dbcore_result_has_result_set.
 */

#include "dbcore/driver.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct dbcore_result dbcore_result;

/* Number of columns (0 for a statement without a result set). */
int dbcore_result_col_count(const dbcore_result *r);

/* Column name, or NULL if col is out of range. Owned by the result. */
const char *dbcore_result_col_name(const dbcore_result *r, int col);

/* Neutral column type, or DBC_TYPE_NULL if col is out of range. */
dbc_type dbcore_result_col_type(const dbcore_result *r, int col);

/* Number of rows actually fetched (see dbcore_result_truncated). */
int dbcore_result_row_count(const dbcore_result *r);

/*
 * Cell text at (row, col). For an index within range, returns NULL ONLY when
 * the cell is SQL NULL (an empty string is returned as ""); the companion
 * dbcore_result_cell_is_null then distinguishes the two. Out-of-range indices
 * also return NULL, so callers that have not already bounded row/col against
 * row_count/col_count must range-check first. Owned by the result.
 */
const char *dbcore_result_cell(const dbcore_result *r, int row, int col);

/*
 * 1 if the cell is SQL NULL, else 0. Out-of-range indices also return 1, so
 * this is not a bounds check — use row_count/col_count for that.
 */
int dbcore_result_cell_is_null(const dbcore_result *r, int row, int col);

/* Rows affected by a non-SELECT statement, as reported by the driver. */
long long dbcore_result_rows_affected(const dbcore_result *r);

/* 1 if more rows existed than were fetched (max_rows cap hit), else 0. */
int dbcore_result_truncated(const dbcore_result *r);

/* 1 if the statement produced a result set (>= 1 column), 0 if it did not. */
int dbcore_result_has_result_set(const dbcore_result *r);

/* Free a result. NULL is a no-op. */
void dbcore_result_free(dbcore_result *r);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_RESULT_H */
