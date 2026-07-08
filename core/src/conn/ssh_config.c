#include "ssh_config.h"

#include "conn_util.h"

#include "cJSON.h"

#include <stdlib.h>
#include <string.h>

/*
 * Pure parser for the ssh_* DSN fields. No sockets, no libssh2 — it turns JSON
 * into a validated ssh_config. The actual port-forward lives in ssh_tunnel.c.
 */

/* Owned copy of a non-empty string field, or NULL when absent/empty. Sets *oom
   when the field is present but cannot be copied. */
static char *dup_field(const cJSON *root, const char *key, int *oom)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(item) || item->valuestring == NULL ||
        item->valuestring[0] == '\0') {
        return NULL;
    }
    size_t n = strlen(item->valuestring) + 1;
    char *copy = malloc(n);
    if (copy == NULL) {
        *oom = 1;
        return NULL;
    }
    memcpy(copy, item->valuestring, n);
    return copy;
}

/* Positive port-range integer (1..65535), or 0 when absent/out of range.
   Accepts both a JSON number and a decimal string: the frontend ships DSN
   values as strings (Record<string,string>), so a port may arrive as "2222". */
static int int_field(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (cJSON_IsNumber(item) && item->valueint > 0 && item->valueint <= 65535) {
        return item->valueint;
    }
    if (cJSON_IsString(item) && item->valuestring != NULL) {
        char *end = NULL;
        long v = strtol(item->valuestring, &end, 10);
        if (end != item->valuestring && *end == '\0' && v > 0 && v <= 65535) {
            return (int)v;
        }
    }
    return 0;
}

ssh_hostkey_policy ssh_hostkey_policy_from_string(const char *s)
{
    if (s != NULL) {
        if (strcmp(s, "strict") == 0) {
            return SSH_HOSTKEY_STRICT;
        }
        if (strcmp(s, "off") == 0) {
            return SSH_HOSTKEY_OFF;
        }
    }
    /* Default (also for "accept-new", NULL, empty, or any unknown value): the
       secure TOFU policy. An unrecognised value must never weaken to "off". */
    return SSH_HOSTKEY_ACCEPT_NEW;
}

dbc_status ssh_config_parse(const char *dsn_json, ssh_config *out,
                            char *err, size_t errcap)
{
    if (out == NULL) {
        conn_copy_err(err, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }
    memset(out, 0, sizeof *out);

    cJSON *root = dsn_json != NULL ? cJSON_Parse(dsn_json) : NULL;
    if (root == NULL) {
        conn_copy_err(err, errcap, "dsn must be a JSON object");
        return DBC_ERR_PARAM;
    }

    int oom = 0;
    char *host = dup_field(root, "ssh_host", &oom);
    if (host == NULL) {
        if (oom) {
            /* ssh_host WAS supplied but could not be copied. Returning "not
               present" here would silently open a direct connection, bypassing
               the intended SSH hop — fail loudly instead. */
            conn_copy_err(err, errcap, "out of memory parsing ssh config");
            cJSON_Delete(root);
            return DBC_ERR_NOMEM;
        }
        /* No ssh_host => plain, non-tunnelled connection. */
        cJSON_Delete(root);
        return DBC_OK;
    }

    out->present = 1;
    out->host = host;
    out->user = dup_field(root, "ssh_user", &oom);
    out->password = dup_field(root, "ssh_password", &oom);
    out->key_path = dup_field(root, "ssh_key", &oom);
    out->key_passphrase = dup_field(root, "ssh_key_passphrase", &oom);

    int ssh_port = int_field(root, "ssh_port");
    out->port = ssh_port > 0 ? ssh_port : 22;

    /* Forward target defaults to the DSN's own host/port (reached from the SSH
       server's network). 127.0.0.1 is the sensible fallback target host. */
    char *target_host = dup_field(root, "ssh_target_host", &oom);
    if (target_host == NULL && !oom) {
        target_host = dup_field(root, "host", &oom);
    }
    out->target_host = target_host;

    int target_port = int_field(root, "ssh_target_port");
    if (target_port == 0) {
        target_port = int_field(root, "port");
    }
    out->target_port = target_port;

    out->known_hosts = dup_field(root, "ssh_known_hosts", &oom);

    /* Classify auth (default agent) and host-key policy BEFORE freeing root: the
       strings point into the cJSON tree and must not be touched after Delete. */
    const cJSON *policy_item =
        cJSON_GetObjectItemCaseSensitive(root, "ssh_host_key_policy");
    out->hostkey_policy = ssh_hostkey_policy_from_string(
        cJSON_IsString(policy_item) ? policy_item->valuestring : NULL);

    const cJSON *auth_item = cJSON_GetObjectItemCaseSensitive(root, "ssh_auth");
    const char *auth = cJSON_IsString(auth_item) ? auth_item->valuestring : NULL;
    int auth_ok = 1;
    if (auth == NULL || strcmp(auth, "agent") == 0) {
        out->auth = SSH_AUTH_AGENT;
    } else if (strcmp(auth, "password") == 0) {
        out->auth = SSH_AUTH_PASSWORD;
    } else if (strcmp(auth, "key") == 0) {
        out->auth = SSH_AUTH_KEY;
    } else {
        auth_ok = 0;
    }

    cJSON_Delete(root);

    if (oom) {
        conn_copy_err(err, errcap, "out of memory parsing ssh config");
        ssh_config_dispose(out);
        return DBC_ERR_NOMEM;
    }

    if (!auth_ok) {
        conn_copy_err(err, errcap, "ssh_auth must be password, key or agent");
        ssh_config_dispose(out);
        return DBC_ERR_PARAM;
    }

    if (out->user == NULL) {
        conn_copy_err(err, errcap, "ssh_user is required for an SSH tunnel");
        ssh_config_dispose(out);
        return DBC_ERR_PARAM;
    }
    if (out->auth == SSH_AUTH_PASSWORD && out->password == NULL) {
        conn_copy_err(err, errcap, "ssh_password is required for password auth");
        ssh_config_dispose(out);
        return DBC_ERR_PARAM;
    }
    if (out->auth == SSH_AUTH_KEY && out->key_path == NULL) {
        conn_copy_err(err, errcap, "ssh_key is required for key auth");
        ssh_config_dispose(out);
        return DBC_ERR_PARAM;
    }

    if (out->target_host == NULL) {
        /* No explicit target and no DSN host: loop back on the SSH server. */
        out->target_host = malloc(sizeof "127.0.0.1");
        if (out->target_host == NULL) {
            conn_copy_err(err, errcap, "out of memory parsing ssh config");
            ssh_config_dispose(out);
            return DBC_ERR_NOMEM;
        }
        memcpy(out->target_host, "127.0.0.1", sizeof "127.0.0.1");
    }

    return DBC_OK;
}

void ssh_config_dispose(ssh_config *cfg)
{
    if (cfg == NULL) {
        return;
    }
    free(cfg->host);
    free(cfg->user);
    free(cfg->password);
    free(cfg->key_path);
    free(cfg->key_passphrase);
    free(cfg->target_host);
    free(cfg->known_hosts);
    memset(cfg, 0, sizeof *cfg);
}
