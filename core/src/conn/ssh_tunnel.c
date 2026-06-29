#include "ssh_tunnel.h"

#include "conn_util.h"

/*
 * SSH tunnel lifecycle.
 *
 * The real port-forward (libssh2 session + auth + a thread pumping bytes between
 * the local listening socket and a direct-tcpip channel) lands behind QUAERO_SSH
 * once the dependency is vendored. Until then this is the honest not-built stub:
 * the feature reports itself unavailable and refuses to open, so a DSN that asks
 * for a tunnel fails loudly instead of leaking the connection past the intended
 * SSH hop.
 */

#ifndef QUAERO_SSH

int ssh_tunnel_available(void)
{
    return 0;
}

dbc_status ssh_tunnel_open(const ssh_config *cfg, ssh_tunnel **out,
                           int *out_local_port, char *err, size_t errcap)
{
    (void)cfg;
    if (out != NULL) {
        *out = NULL;
    }
    if (out_local_port != NULL) {
        *out_local_port = 0;
    }
    conn_copy_err(err, errcap,
                  "SSH tunnel support is not built in (rebuild with QUAERO_SSH)");
    return DBC_ERR_UNSUPPORTED;
}

void ssh_tunnel_close(ssh_tunnel *t)
{
    (void)t;
}

#endif /* !QUAERO_SSH */
