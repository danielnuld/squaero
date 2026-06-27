#ifndef DBCORE_QUERY_H
#define DBCORE_QUERY_H

/*
 * Query execution: run SQL on an open connection and materialize a neutral
 * dbcore_result. The driver vtable does the engine-specific work; this layer
 * drives the cursor (next_row/cell_text), copies values out (they are only
 * valid until the next step), maps nothing — column types stay as the driver's
 * neutral dbc_type.
 */

#include "dbcore/conn.h"
#include "dbcore/driver.h"
#include "dbcore/result.h"

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Execute `sql` on the connection borrowed in `conn` (see
 * dbcore_conn_manager_get) and write the materialized result to *out.
 *
 * `max_rows` bounds how many rows are fetched: <= 0 means all rows; > 0 caps the
 * fetch and, if the driver had more rows, sets dbcore_result_truncated. The cap
 * is never silent — it is always reported through that flag.
 *
 * On success returns DBC_OK and *out owns a result (free with
 * dbcore_result_free). On failure returns the driver/validation status, sets
 * *out to NULL, and copies a human-readable reason into errbuf (when errbuf !=
 * NULL and errcap > 0; always NUL-terminated):
 *   DBC_ERR_PARAM - conn/driver/handle/sql/out is NULL.
 *   DBC_ERR_QUERY - the driver failed to execute or to iterate the rows.
 *   DBC_ERR_NOMEM - the result could not be allocated.
 */
dbc_status dbcore_query_run(const dbcore_conn_ref *conn, const char *sql,
                            int max_rows, dbcore_result **out,
                            char *errbuf, size_t errcap);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_QUERY_H */
