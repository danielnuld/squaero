#ifndef DBCORE_CONN_SSH_TUNNEL_H
#define DBCORE_CONN_SSH_TUNNEL_H

/*
 * SSH port-forward lifecycle. Given a parsed ssh_config (see ssh_config.h), the
 * tunnel opens a listening socket on 127.0.0.1:<local_port> and forwards every
 * accepted connection to ssh_config.target_host:target_port through an SSH
 * session to ssh_config.host. The connection manager opens the tunnel before
 * the driver connects and closes it after the driver disconnects.
 *
 * The forwarding implementation is backed by libssh2 and is compiled in only
 * when QUAERO_SSH is defined (the build vendors libssh2 + a crypto backend).
 * When it is NOT compiled in, ssh_tunnel_available() returns 0 and
 * ssh_tunnel_open() fails with DBC_ERR_UNSUPPORTED rather than silently
 * connecting straight to the database — honest failure over fake success.
 *
 * This header is deliberately backend-agnostic: it exposes no libssh2 type, so
 * the connection manager and its tests link against it regardless of QUAERO_SSH.
 */

#include "ssh_config.h"  /* ssh_config + dbc_status (via dbcore/driver.h) */

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ssh_tunnel ssh_tunnel;

/* 1 when SSH-tunnel support is compiled in (libssh2 available), else 0. */
int ssh_tunnel_available(void);

/*
 * Open a local TCP forward described by cfg. On success returns DBC_OK, sets
 * *out to an owned tunnel handle, and writes the chosen loopback port (the one
 * the driver should connect to) to *out_local_port.
 *
 * On failure returns a non-OK status (DBC_ERR_UNSUPPORTED when not compiled in,
 * DBC_ERR_CONN on an SSH/network failure, DBC_ERR_PARAM/DBC_ERR_NOMEM otherwise),
 * leaves *out NULL, and copies a human-readable reason into err (when err != NULL
 * and errcap > 0; always NUL-terminated).
 */
dbc_status ssh_tunnel_open(const ssh_config *cfg, ssh_tunnel **out,
                           int *out_local_port, char *err, size_t errcap);

/* Tear down the forward and free the handle. NULL is a no-op. */
void ssh_tunnel_close(ssh_tunnel *t);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_CONN_SSH_TUNNEL_H */
