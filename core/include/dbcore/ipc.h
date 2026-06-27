#ifndef DBCORE_IPC_H
#define DBCORE_IPC_H

/*
 * JSON-RPC 2.0 dispatcher for the core <-> frontend channel.
 *
 * This is the single stability boundary between the C core and the webview
 * frontend (see docs/IPC.md and .rules/ipc.md). The transport (webview bind)
 * is wired up separately in the app shell; this module is pure: JSON string in,
 * JSON string out, so it can be unit-tested without a webview.
 */

#ifdef __cplusplus
extern "C" {
#endif

/* Protocol version negotiated by the `app.hello` handshake.
   v2 is the M1 data path: conn.open / conn.close / query.run + -32000.. errors. */
#define DBCORE_IPC_PROTOCOL_VERSION 2

/*
 * Handles a single JSON-RPC request and returns the response as a newly
 * allocated, NUL-terminated JSON string. The caller owns the result and must
 * release it with dbcore_ipc_free().
 *
 * `request_json` must not be NULL. Malformed input does not fail the call: it
 * produces a well-formed JSON-RPC error response (e.g. -32700 parse error).
 *
 * Returns NULL only on memory allocation failure.
 */
char *dbcore_ipc_handle(const char *request_json);

/* Frees a string returned by dbcore_ipc_handle(). NULL is a no-op. */
void dbcore_ipc_free(char *response_json);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_IPC_H */
