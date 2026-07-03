#ifndef DBCORE_TX_H
#define DBCORE_TX_H

/*
 * Transaction control on an open connection. Thin wrappers over the driver
 * vtable's begin/commit/rollback members: they exist so the IPC layer (and any
 * other core caller) never inspects the vtable or its capability flags directly.
 *
 * A driver supports transactions only when it advertises DBC_FEAT_TRANSACTIONS
 * and provides all three members; otherwise these return DBC_ERR_UNSUPPORTED
 * with an explicit reason rather than silently pretending to succeed. This backs
 * the safe-edit flow (issue #28): the frontend brackets a batch of row edits in
 * begin/commit, and a rollback abandons them.
 */

#include "dbcore/conn.h"
#include "dbcore/driver.h"

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Begin / commit / rollback a transaction on the connection borrowed in `conn`
 * (see dbcore_conn_manager_get).
 *
 * On success returns DBC_OK. On failure returns the driver/validation status and
 * copies a human-readable reason into errbuf (when errbuf != NULL and errcap > 0;
 * always NUL-terminated):
 *   DBC_ERR_PARAM       - conn/driver/handle is NULL.
 *   DBC_ERR_UNSUPPORTED - the driver does not advertise DBC_FEAT_TRANSACTIONS
 *                         (or is missing a member).
 *   DBC_ERR_QUERY       - the driver failed to start/finish the transaction.
 */
dbc_status dbcore_tx_begin(const dbcore_conn_ref *conn, char *errbuf, size_t errcap);
dbc_status dbcore_tx_commit(const dbcore_conn_ref *conn, char *errbuf, size_t errcap);
dbc_status dbcore_tx_rollback(const dbcore_conn_ref *conn, char *errbuf, size_t errcap);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_TX_H */
