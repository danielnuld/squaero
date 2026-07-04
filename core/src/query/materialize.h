#ifndef DBCORE_QUERY_MATERIALIZE_H
#define DBCORE_QUERY_MATERIALIZE_H

/*
 * Shared materialization of a driver result (dbc_result) into a neutral
 * dbcore_result. Used by both query execution (run.c) and schema introspection
 * (schema.c), so the row-fetch loop, the limit+1 truncation technique and the
 * error handling live in exactly one place.
 */

#include "dbcore/driver.h"
#include "dbcore/result.h"

#include <stddef.h>

/* Copy `msg` (NULL -> a generic reason) into errbuf, truncating to fit and
   always NUL-terminating. No-op when errbuf is NULL or errcap is 0. Shared by
   the query and schema layers. */
void dbcore_copy_error(char *errbuf, size_t errcap, const char *msg);

/*
 * Drain `dr` (a result just produced by `drv` on connection `handle`) into a
 * freshly allocated dbcore_result written to *out.
 *
 * Takes ownership of `dr`: it is always freed via drv->free_result before
 * return, on every path. `handle` is borrowed and used only to read the
 * driver's last_error on failure.
 *
 * `offset` skips that many leading rows (fetched and discarded) before any are
 * collected — the row-skipping half of offset pagination (issue #134). <= 0
 * skips nothing.
 *
 * `max_rows` bounds the fetch of the rows that remain after the skip: <= 0 means
 * all of them; > 0 caps it and sets dbcore_result_truncated when the driver had
 * yet more (i.e. a further page exists).
 *
 * Returns DBC_OK with *out owning the result, or DBC_ERR_QUERY / DBC_ERR_NOMEM
 * with *out set to NULL and a reason copied into errbuf (when errcap > 0).
 */
dbc_status dbcore_materialize(const dbc_driver_t *drv, dbc_conn *handle,
                              dbc_result *dr, int max_rows, int offset,
                              dbcore_result **out, char *errbuf, size_t errcap);

#endif /* DBCORE_QUERY_MATERIALIZE_H */
