#ifndef DBCORE_QUERY_RESULT_PRIV_H
#define DBCORE_QUERY_RESULT_PRIV_H

/*
 * Internal builder API for dbcore_result, shared between result.c (storage +
 * accessors) and run.c (materialization). Not part of the public surface.
 */

#include "dbcore/driver.h"
#include "dbcore/result.h"

/* Allocate a result with space for col_count columns (>= 0), or NULL on OOM. */
dbcore_result *dbcore_result_create(int col_count);

/* Set column `col`'s name (copied) and neutral type. Returns 1, or 0 on OOM. */
int dbcore_result_set_column(dbcore_result *r, int col, const char *name,
                             dbc_type type);

/*
 * Append a row. `cells` has col_count entries; a NULL entry is stored as SQL
 * NULL, a non-NULL entry is copied. A NULL `cells` pointer stores the whole row
 * as SQL NULL. For a zero-column result the call just bumps the row count.
 * Returns 1, or 0 on OOM.
 */
int dbcore_result_add_row(dbcore_result *r, const char *const *cells);

void dbcore_result_set_rows_affected(dbcore_result *r, long long n);
void dbcore_result_set_truncated(dbcore_result *r, int truncated);

#endif /* DBCORE_QUERY_RESULT_PRIV_H */
