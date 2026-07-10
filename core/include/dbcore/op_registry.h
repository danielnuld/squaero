#ifndef DBCORE_OP_REGISTRY_H
#define DBCORE_OP_REGISTRY_H

/*
 * In-flight query registry — the one thread-aware corner of the otherwise
 * single-threaded core. It records, per connection id, the (driver, handle) of
 * the query currently running so that a cancel request arriving on ANOTHER
 * thread can reach the driver's cancel hook while the query is still in flight.
 *
 * A connection runs at most one query at a time (the core serializes access per
 * conn), so the registry is keyed by connection id: begin marks a conn busy,
 * end clears it, cancel interrupts it. All three are safe to call concurrently.
 *
 * The stored dbc_conn* stays valid for the duration of a cancel because a
 * connection cannot be closed while its query is running (conn.close is
 * serialized behind the running query on the same worker).
 */

#include "dbcore/driver.h"

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Mark conn_id as running a query on (driver, handle). Replaces any previous
 * entry for that id. driver/handle must stay valid until dbcore_op_end. A no-op
 * (cancel simply won't find the conn) if the registry is momentarily full.
 */
void dbcore_op_begin(int conn_id, const dbc_driver_t *driver, dbc_conn *handle);

/* Clear the running-query mark for conn_id. Harmless if none is set. */
void dbcore_op_end(int conn_id);

/*
 * Request cancellation of the query running on conn_id by invoking the driver's
 * cancel hook. Thread-safe; may run concurrently with the query on the worker
 * thread (the documented exception to the single-thread-per-conn rule).
 *
 * Returns:
 *   DBC_OK             - a cancel was delivered to the driver.
 *   DBC_ERR_PARAM      - no query is currently running on conn_id (nothing to do).
 *   DBC_ERR_UNSUPPORTED- a query is running but the driver cannot cancel it
 *                        (no cancel hook / DBC_FEAT_CANCEL not advertised).
 */
dbc_status dbcore_op_cancel(int conn_id);

/* Drop all entries. For test isolation; the app does not need to call it. */
void dbcore_op_registry_reset(void);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_OP_REGISTRY_H */
