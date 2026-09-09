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
 * `offset` skips that many leading rows before collecting (offset pagination,
 * issue #134); <= 0 skips nothing. `max_rows` bounds how many of the remaining
 * rows are fetched: <= 0 means all; > 0 caps the fetch and, if the driver had
 * yet more rows, sets dbcore_result_truncated (a further page exists). The cap is
 * never silent — it is always reported through that flag.
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
                            int max_rows, int offset, dbcore_result **out,
                            char *errbuf, size_t errcap);

/*
 * Execute `sql` and return its FIRST page, keeping the driver's result open so
 * the next page can continue the same execution (issue #478) instead of running
 * the query again and skipping rows.
 *
 * On DBC_OK *out owns the page (free with dbcore_result_free) and *out_cursor is
 * the still-open driver result WHEN the page came back truncated (a further page
 * exists); otherwise *out_cursor is NULL and nothing has to be released. A
 * non-NULL *out_cursor must eventually be handed to dbcore_query_next until it
 * closes, or freed with driver->free_result.
 *
 * Errors are those of dbcore_query_run; *out and *out_cursor are NULL.
 */
dbc_status dbcore_query_open(const dbcore_conn_ref *conn, const char *sql,
                             int max_rows, dbcore_result **out,
                             dbc_result **out_cursor, char *errbuf, size_t errcap);

/*
 * The next page off a cursor opened by dbcore_query_open. `cursor` is borrowed:
 * *out_open is 1 when it is still alive (yet another page may follow) and 0 when
 * it has been closed and freed — on exhaustion AND on failure, so the caller
 * must drop its pointer whenever *out_open is 0.
 *
 * DBC_ERR_PARAM for a NULL argument, DBC_ERR_QUERY if the driver failed to
 * iterate, DBC_ERR_NOMEM if the page could not be allocated.
 */
dbc_status dbcore_query_next(const dbcore_conn_ref *conn, dbc_result *cursor,
                             int max_rows, dbcore_result **out, int *out_open,
                             char *errbuf, size_t errcap);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_QUERY_H */
