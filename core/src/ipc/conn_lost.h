#ifndef DBCORE_IPC_CONN_LOST_H
#define DBCORE_IPC_CONN_LOST_H

#include "cJSON.h"

/*
 * The `data` of a -32000 error answered by a method that ran on an OPEN
 * connection (issue #676): the session died under it. The core does not keep the
 * DSN, so reconnecting is the frontend's job; this says whether it may also
 * re-send the call afterwards:
 *
 *   { "connLost": true, "inTx": <bool>, "retrySafe": <bool> }
 *
 * `inTx`      — a transaction tx.begin opened was still open when the call was
 *               made; the server rolled it back with the session.
 * `retrySafe` — re-sending the same call on a fresh session cannot repeat a
 *               change: a query.run outside a transaction whose SQL the
 *               fail-closed classifier (dbcore/stmt_class.h) proves read-only.
 *               Everything else — writes, tx.*, row.*, paging a cursor that
 *               died with the session — is false.
 *
 * Pure: no runtime, no I/O. Returns a new object (caller owns it) or NULL on
 * allocation failure.
 */
cJSON *ipc_conn_lost_data(const char *method, const cJSON *params, int in_tx);

#endif /* DBCORE_IPC_CONN_LOST_H */
