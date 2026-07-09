#ifndef DBCORE_CONN_SSH_CONFIG_H
#define DBCORE_CONN_SSH_CONFIG_H

/*
 * SSH-tunnel configuration parsed from a connection DSN.
 *
 * The tunnel is engine-agnostic: any network driver can be reached through it.
 * The core reads the ssh_* fields from the DSN, opens a local port-forward to
 * the database BEFORE handing a (rewritten) DSN to the driver, and the driver
 * connects to 127.0.0.1:<local_port> none the wiser. This module is the pure,
 * I/O-free parser/validator for those fields; it allocates owned copies of the
 * strings and the caller disposes them.
 *
 * Recognised DSN fields (all optional unless noted):
 *   ssh_host            SSH server host. Its PRESENCE is what turns tunnelling
 *                       on; absent => not a tunnelled connection.
 *   ssh_port            SSH server port (default 22).
 *   ssh_user            SSH username (required when ssh_host is present).
 *   ssh_auth            "password" | "key" | "agent" (default "agent").
 *   ssh_password        password for ssh_auth=password (required for it).
 *   ssh_key             path to a private key for ssh_auth=key (required for it).
 *   ssh_key_passphrase  optional passphrase protecting ssh_key.
 *   ssh_target_host     forward target host (default: the DSN "host", or
 *                       127.0.0.1 when the DSN has none).
 *   ssh_target_port     forward target port (default: the DSN "port", or 0,
 *                       which the driver resolves to its engine default).
 *   ssh_host_key_policy "accept-new" | "strict" | "off" (default "accept-new").
 *                       accept-new = TOFU: an unknown host key is accepted and
 *                       recorded, but a CHANGED key is rejected (MITM). strict =
 *                       reject unknown keys too. off = no verification (legacy).
 *   ssh_known_hosts     path to the known_hosts store (default ~/.ssh/known_hosts).
 */

#include "dbcore/status.h"  /* dbc_status only — no need for the full driver ABI */

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SSH_AUTH_AGENT = 0, /* default: use the running SSH agent */
    SSH_AUTH_PASSWORD,
    SSH_AUTH_KEY
} ssh_auth_method;

typedef enum {
    SSH_HOSTKEY_ACCEPT_NEW = 0, /* TOFU: record unknown keys, reject changed */
    SSH_HOSTKEY_STRICT,         /* reject unknown keys as well */
    SSH_HOSTKEY_OFF             /* no verification (legacy behaviour) */
} ssh_hostkey_policy;

typedef struct {
    int                present;        /* 1 when ssh_host was supplied */
    char              *host;
    int                port;           /* >0; defaulted to 22 */
    char              *user;
    ssh_auth_method    auth;
    char              *password;       /* owned; NULL unless auth=password */
    char              *key_path;       /* owned; NULL unless auth=key */
    char              *key_passphrase; /* owned; optional */
    char              *target_host;    /* owned; forward target */
    int                target_port;    /* forward target; 0 = engine default */
    ssh_hostkey_policy hostkey_policy; /* how to verify the server host key */
    char              *known_hosts;    /* owned; NULL => default ~/.ssh/known_hosts */
} ssh_config;

/* Parse a host-key policy string ("accept-new" | "strict" | "off"), or the
   default (accept-new) for NULL/empty/unknown. Pure; exposed for testing. */
ssh_hostkey_policy ssh_hostkey_policy_from_string(const char *s);

/*
 * Parse the ssh_* fields from a DSN JSON object into *out (zeroed first).
 *
 * Returns:
 *   DBC_OK         - parsed. out->present is 0 when no ssh_host was given (a
 *                    plain, non-tunnelled connection), 1 otherwise.
 *   DBC_ERR_PARAM  - dsn_json is not a JSON object, or the SSH config is present
 *                    but invalid (missing user, unknown ssh_auth, password auth
 *                    without ssh_password, key auth without ssh_key). A
 *                    human-readable reason is copied into err (when err != NULL
 *                    and errcap > 0; always NUL-terminated).
 *   DBC_ERR_NOMEM  - a required string could not be copied.
 *
 * On any non-OK return *out is left disposed (no owned memory leaks); the caller
 * may still call ssh_config_dispose on it safely.
 */
dbc_status ssh_config_parse(const char *dsn_json, ssh_config *out,
                            char *err, size_t errcap);

/* Free owned strings and zero the struct. NULL is a no-op. */
void ssh_config_dispose(ssh_config *cfg);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_CONN_SSH_CONFIG_H */
