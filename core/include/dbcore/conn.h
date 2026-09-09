#ifndef DBCORE_CONN_H
#define DBCORE_CONN_H

/*
 * Connection manager — owns the lifecycle of live database connections opened
 * through a driver vtable (see dbcore/driver.h).
 *
 * The manager holds, per open connection, only the driver vtable pointer and
 * the opaque dbc_conn handle the driver returned. It deliberately does NOT
 * retain the DSN JSON or any credential material: secrets live only for the
 * duration of the driver's connect() call and are never copied into the core's
 * long-lived state. (Saved-connection profiles — issue #16 — persist metadata
 * without secrets; that is a separate layer.)
 *
 * Connections are identified by a small positive integer id, unique for the
 * lifetime of the manager (ids are never reused). The manager is single-threaded
 * like the rest of the core: the caller serializes access.
 */

#include "dbcore/driver.h"

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct dbcore_conn_manager dbcore_conn_manager;

/* A borrowed view of a live connection, for query execution (issue #9). The
   pointers are owned by the manager and valid until the connection is closed. */
typedef struct {
    const dbc_driver_t *driver;
    dbc_conn           *handle;
} dbcore_conn_ref;

/* Create an empty manager, or NULL on allocation failure. */
dbcore_conn_manager *dbcore_conn_manager_new(void);

/* Close every open connection and free the manager. NULL is a no-op. */
void dbcore_conn_manager_free(dbcore_conn_manager *mgr);

/*
 * Open a connection: calls driver->connect(dsn_json, ...) and, on success,
 * registers the handle and writes its id (>= 1) to *out_id.
 *
 * On failure the driver status is returned, *out_id is set to 0, any partial
 * handle is disconnected, and a human-readable reason is copied into errbuf
 * (when errbuf != NULL and errcap > 0; always NUL-terminated). The reason comes
 * from driver->last_error when available, otherwise a generic message.
 *
 * Returns DBC_ERR_PARAM if mgr, driver, dsn_json or out_id is NULL, or if the
 * driver violates its contract (reports success but yields no handle).
 */
dbc_status dbcore_conn_manager_open(dbcore_conn_manager *mgr,
                                    const dbc_driver_t *driver,
                                    const char *dsn_json, int *out_id,
                                    char *errbuf, size_t errcap);

/*
 * Close the connection with the given id (calls driver->disconnect).
 * Returns DBC_OK, or DBC_ERR_PARAM if no open connection has that id (this
 * function does not distinguish "bad id" from "unknown id" — callers that need
 * to probe existence should use dbcore_conn_manager_get instead).
 */
dbc_status dbcore_conn_manager_close(dbcore_conn_manager *mgr, int id);

/*
 * Borrow the driver+handle for an open connection. Returns 1 and fills *out on
 * success, or 0 if the id is unknown or out is NULL (*out untouched). This is
 * the canonical existence check for a connection id.
 */
int dbcore_conn_manager_get(const dbcore_conn_manager *mgr, int id,
                            dbcore_conn_ref *out);

/*
 * Paging cursor (issue #478): the driver result left OPEN after one page was
 * materialized, so the next page continues that same execution instead of
 * re-running the query. At most one per connection — the manager owns it and
 * frees it (driver->free_result) when it is replaced, when the connection is
 * closed, and when the manager is freed.
 *
 * ponytail: one cursor per connection, so a second query on the same connection
 * drops the first one's cursor and its pages fall back to re-running with an
 * offset. Key them by a cursor id if per-tab paging has to survive that.
 */

/* Store `cursor` as the connection's paging cursor, freeing any previous one.
   NULL just frees the previous. Returns 1, or 0 if the id is unknown (in which
   case `cursor` is NOT freed — the caller still owns it). */
int dbcore_conn_manager_set_cursor(dbcore_conn_manager *mgr, int id,
                                   dbc_result *cursor);

/* Detach the connection's paging cursor and hand ownership to the caller (which
   must free it via the driver or hand it back with set_cursor). NULL when the id
   is unknown or no cursor is open. */
dbc_result *dbcore_conn_manager_take_cursor(dbcore_conn_manager *mgr, int id);

/* Number of currently open connections. */
int dbcore_conn_manager_count(const dbcore_conn_manager *mgr);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_CONN_H */
