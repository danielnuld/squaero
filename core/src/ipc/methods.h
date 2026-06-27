#ifndef DBCORE_IPC_METHODS_H
#define DBCORE_IPC_METHODS_H

#include "cJSON.h"

/*
 * A method handler builds and returns its `result` object on success and sets
 * *code to 0. On failure it returns NULL, sets *code to a JSON-RPC error code
 * and *message to a static (non-owned) human-readable string.
 *
 * `params` is the request's "params" value and may be NULL.
 */
typedef cJSON *(*ipc_method_fn)(const cJSON *params, int *code,
                                const char **message);

/* app.hello — protocol handshake. Returns name, coreVersion, protocolVersion. */
cJSON *ipc_method_hello(const cJSON *params, int *code, const char **message);

/* ping — liveness check. Returns {"pong": true}, echoing params.message. */
cJSON *ipc_method_ping(const cJSON *params, int *code, const char **message);

/* Resolves a method name to its handler, or NULL if unknown. */
ipc_method_fn ipc_method_lookup(const char *method);

#endif /* DBCORE_IPC_METHODS_H */
