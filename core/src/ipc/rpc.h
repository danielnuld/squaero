#ifndef DBCORE_IPC_RPC_H
#define DBCORE_IPC_RPC_H

#include "cJSON.h"

/* JSON-RPC 2.0 standard error codes. */
#define IPC_ERR_PARSE        (-32700)
#define IPC_ERR_INVALID_REQ  (-32600)
#define IPC_ERR_METHOD       (-32601)
#define IPC_ERR_PARAMS       (-32602)
#define IPC_ERR_INTERNAL     (-32603)

/* Server-defined domain errors (JSON-RPC reserves -32000..-32099). */
#define IPC_ERR_CONN         (-32000)  /* connection could not be opened/used */
#define IPC_ERR_UNSUPPORTED  (-32001)  /* operation unsupported by the driver */
#define IPC_ERR_NOT_FOUND    (-32002)  /* unknown connection / driver */

/*
 * Builds a JSON-RPC success envelope:
 *   {"jsonrpc":"2.0","id":<id>,"result":<result>}
 * `id` is duplicated (the caller keeps ownership of its tree); `result` is
 * consumed (ownership transferred). `id` may be NULL -> serialized as null.
 * Returns a newly allocated string (caller frees) or NULL on allocation failure.
 */
char *ipc_response_success(const cJSON *id, cJSON *result);

/*
 * Builds a JSON-RPC error envelope:
 *   {"jsonrpc":"2.0","id":<id>,"error":{"code":<code>,"message":<message>}}
 * `id` is duplicated; may be NULL -> null. Returns a newly allocated string
 * (caller frees) or NULL on allocation failure.
 */
char *ipc_response_error(const cJSON *id, int code, const char *message);

#endif /* DBCORE_IPC_RPC_H */
