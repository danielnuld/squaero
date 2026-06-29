#ifndef DBCORE_CONN_DSN_REWRITE_H
#define DBCORE_CONN_DSN_REWRITE_H

/*
 * DSN rewriting for tunnelled connections. When a connection is opened through
 * an SSH tunnel (see ssh_config.h / ssh_tunnel.h), the driver must be pointed at
 * the local end of the forward instead of the real database host. This helper
 * produces that rewritten DSN: it sets "host" to the loopback address and
 * "port" to the local forward port, drops any "socket" (so the driver uses TCP
 * and cannot bypass the tunnel via a Unix socket), and preserves every other
 * field (user, password, database, ssl options, ...). Pure, no I/O.
 */

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Return a newly allocated JSON DSN string identical to dsn_json except with
 * "host" = "127.0.0.1", "port" = local_port, and "socket" removed. The caller
 * frees the result with free().
 *
 * Returns NULL when dsn_json is not a JSON object, local_port is not in
 * [1, 65535], or allocation fails.
 */
char *dsn_rewrite_loopback(const char *dsn_json, int local_port);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_CONN_DSN_REWRITE_H */
