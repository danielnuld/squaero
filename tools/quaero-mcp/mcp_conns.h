#ifndef QUAERO_MCP_CONNS_H
#define QUAERO_MCP_CONNS_H

#include "cJSON.h"

#include <stddef.h>

/*
 * Connection registry for the MCP server (issue #184).
 *
 * The server never sees the app's localStorage connections; instead the user
 * points it at a JSON file in the same versioned shape the app exports
 * (`{ "version": 1, "connections": [ { id, name, driver, params, ... } ] }`,
 * issue #188), with two extra per-connection flags that drive the security
 * model:
 *   - "mcp":      opt-in. A connection is invisible to MCP unless this is true.
 *   - "mcpWrite": allow writes. When false (the default) the read-only gate
 *                 rejects any statement not provably read-only.
 * Both default to false, so a plain exported file exposes nothing until the
 * user deliberately marks connections.
 */

typedef struct {
    const char *id;      /* stable identifier (borrowed) */
    const char *name;    /* display name (borrowed) */
    const char *driver;  /* driver plugin name (borrowed) */
    const cJSON *params; /* DSN object passed verbatim to conn.open (borrowed) */
    int allow_write;     /* mcpWrite flag */
} mcp_conn_t;

typedef struct mcp_conns mcp_conns_t;

/*
 * Parse the connections JSON. Only connections with "mcp": true are retained.
 * On success returns a non-NULL registry (possibly with zero connections) and
 * *out is set; on a malformed document returns NULL and writes a reason into
 * err. `json` is not retained (an internal copy is parsed).
 */
mcp_conns_t *mcp_conns_parse(const char *json, char *err, size_t errlen);

/* Read `path` and parse it. Same contract as mcp_conns_parse. */
mcp_conns_t *mcp_conns_load_file(const char *path, char *err, size_t errlen);

/* Number of MCP-enabled connections. */
size_t mcp_conns_count(const mcp_conns_t *c);

/* MCP-enabled connection at index i (< count), or NULL. */
const mcp_conn_t *mcp_conns_at(const mcp_conns_t *c, size_t i);

/* Find an MCP-enabled connection by id first, then by name. NULL if none. */
const mcp_conn_t *mcp_conns_find(const mcp_conns_t *c, const char *id_or_name);

void mcp_conns_free(mcp_conns_t *c);

#endif /* QUAERO_MCP_CONNS_H */
