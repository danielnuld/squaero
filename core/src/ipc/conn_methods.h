#ifndef DBCORE_IPC_CONN_METHODS_H
#define DBCORE_IPC_CONN_METHODS_H

#include "cJSON.h"

#include <stddef.h>

/*
 * IPC handlers for the active-connection lifecycle (conn.open / conn.close).
 * They operate on the process runtime (dbcore/runtime.h): conn.open resolves a
 * registered driver by name and opens a connection; conn.close tears one down.
 * The driver's last_error is propagated to the caller as the JSON-RPC error
 * message. See docs/IPC.md.
 */

/* conn.open — params {driver: string, dsn: object|string}.
   result {connId: "c<N>"}. */
cJSON *ipc_method_conn_open(const cJSON *params, int *code, const char **message);

/* conn.close — params {connId: "c<N>"}. result {closed: true}. */
cJSON *ipc_method_conn_close(const cJSON *params, int *code, const char **message);

/*
 * Connection-id string helpers, exposed for unit testing. The wire id is
 * "c<N>" with N a positive integer.
 *
 * ipc_conn_id_format writes "c<id>" into buf (buf must hold it); returns buf.
 * ipc_conn_id_parse returns 1 and writes the integer to *out for a well-formed
 * "c<N>" (N >= 1), else returns 0.
 */
char *ipc_conn_id_format(int id, char *buf, size_t cap);
int   ipc_conn_id_parse(const char *s, int *out);

#endif /* DBCORE_IPC_CONN_METHODS_H */
