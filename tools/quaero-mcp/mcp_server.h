#ifndef QUAERO_MCP_SERVER_H
#define QUAERO_MCP_SERVER_H

#include "mcp_conns.h"

/*
 * Model Context Protocol server core (issue #184).
 *
 * Speaks MCP (JSON-RPC 2.0) and translates its `tools/call` requests into the
 * Quaero core's own JSON-RPC (dbcore_ipc_handle), enforcing the security model:
 * connections must be opted in, and writes are refused unless the connection is
 * explicitly writable (statements are vetted by the pure classifier).
 *
 * Pure with respect to I/O: one request string in, one response string out (or
 * NULL for a notification, which has no reply). The main loop owns stdio; the
 * core owns drivers and connections. Connections are opened lazily and cached.
 */

typedef struct mcp_server mcp_server_t;

/* Create a server over an already-parsed connection registry (borrowed; the
   caller keeps ownership and must outlive the server). */
mcp_server_t *mcp_server_new(mcp_conns_t *conns);

/* Server + build metadata reported in `initialize`. */
void mcp_server_set_info(mcp_server_t *s, const char *name, const char *version);

/*
 * Handle one MCP JSON-RPC request. Returns a newly allocated response string the
 * caller must free(), or NULL when the request is a notification (no reply) or
 * on allocation failure. Malformed input yields a well-formed JSON-RPC error.
 */
char *mcp_server_handle(mcp_server_t *s, const char *request_json);

void mcp_server_free(mcp_server_t *s);

#endif /* QUAERO_MCP_SERVER_H */
