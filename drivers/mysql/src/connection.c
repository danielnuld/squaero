#include "internal.h"
#include "utils/ssl.h"

#include "cJSON.h"

#include <stdlib.h>
#include <string.h>

/*
 * Connection lifecycle for the MySQL/MariaDB driver. The DSN arrives as JSON:
 *
 *   { "host": "127.0.0.1", "port": 3306, "user": "root",
 *     "password": "secret", "database": "app", "socket": "/var/run/mysqld.sock",
 *     "ssl_mode": "required", "ssl_ca": "...", "ssl_cert": "...", "ssl_key": "..." }
 *
 * All fields are optional; the client library applies its own defaults. TLS is
 * configured from the ssl_* fields before connecting (see configure_ssl). On any
 * failure connect still returns the (error-state) handle so the core can read
 * last_error before disconnecting it. The engine-agnostic SSH tunnel is handled
 * in the core (issue #76), transparently to this driver.
 */

static void set_err(dbc_conn *c, const char *msg)
{
    if (c == NULL) {
        return;
    }
    size_t n = strlen(msg);
    if (n >= sizeof c->err) {
        n = sizeof c->err - 1;
    }
    memcpy(c->err, msg, n);
    c->err[n] = '\0';
}

/* Owned copy of a DSN string field, or NULL when absent/empty. When the field
   IS present but the copy cannot be allocated, *oom is set to 1 so the caller
   can fail loudly instead of silently connecting with a default. */
static char *dup_string(const cJSON *root, const char *key, int *oom)
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

/*
 * Configure TLS on c->db from the ssl_* DSN fields, before connecting. Returns
 * 0 on success (including "no SSL requested"), or -1 with a reason stashed in c
 * for an invalid ssl_mode or an allocation failure.
 *
 * ssl_ca/ssl_cert/ssl_key feed mysql_ssl_set (the library copies them). ssl_mode
 * drives MYSQL_OPT_SSL_MODE: required encrypts without cert verification;
 * verify_ca/verify_identity additionally verify the server certificate (and, for
 * identity, the hostname). Both MariaDB Connector/C 3.x and MySQL 5.7+ expose
 * MYSQL_OPT_SSL_MODE; on an older client without it we still apply any provided
 * certificates but cannot enforce the mode (documented; effectively unreachable
 * on supported clients).
 */
static int configure_ssl(dbc_conn *c, const cJSON *root)
{
    int oom = 0;
    char *ca = dup_string(root, "ssl_ca", &oom);
    char *cert = dup_string(root, "ssl_cert", &oom);
    char *key = dup_string(root, "ssl_key", &oom);
    if (oom) {
        free(ca);
        free(cert);
        free(key);
        set_err(c, "out of memory parsing ssl dsn fields");
        return -1;
    }

    const cJSON *mode_item = cJSON_GetObjectItemCaseSensitive(root, "ssl_mode");
    const char *mode_str =
        cJSON_IsString(mode_item) ? mode_item->valuestring : NULL;
    mysql_ssl_mode mode;
    if (!mysql_ssl_mode_parse(mode_str, &mode)) {
        free(ca);
        free(cert);
        free(key);
        set_err(c, "ssl_mode must be disabled, required, verify_ca or "
                   "verify_identity");
        return -1;
    }

    /* mysql_ssl_set is what actually arms the client's TLS subsystem in MariaDB
       Connector/C; MYSQL_OPT_SSL_MODE/ENFORCE alone do not. Call it whenever the
       mode wants encryption (even with no certs) or any cert was provided, so
       ssl_mode=required negotiates TLS instead of silently staying plaintext. */
    int want_tls = (mode == MYSQL_SSL_REQUIRED ||
                    mode == MYSQL_SSL_VERIFY_CA ||
                    mode == MYSQL_SSL_VERIFY_IDENTITY);
    if (want_tls || ca != NULL || cert != NULL || key != NULL) {
        mysql_ssl_set(c->db, key, cert, ca, NULL, NULL);
    }
    free(ca);
    free(cert);
    free(key);

    if (mode != MYSQL_SSL_UNSET) {
#ifdef MYSQL_OPT_SSL_MODE
        unsigned int m;
        switch (mode) {
        case MYSQL_SSL_DISABLED:        m = SSL_MODE_DISABLED; break;
        case MYSQL_SSL_REQUIRED:        m = SSL_MODE_REQUIRED; break;
        case MYSQL_SSL_VERIFY_CA:       m = SSL_MODE_VERIFY_CA; break;
        case MYSQL_SSL_VERIFY_IDENTITY: m = SSL_MODE_VERIFY_IDENTITY; break;
        default:                        m = SSL_MODE_REQUIRED; break;
        }
        mysql_options(c->db, MYSQL_OPT_SSL_MODE, &m);
#endif
        /* MariaDB Connector/C honours SSL_MODE inconsistently across versions;
           its native enforcement knobs are MYSQL_OPT_SSL_ENFORCE (encrypt) and
           MYSQL_OPT_SSL_VERIFY_SERVER_CERT (verify the cert). Set them too where
           present — both are MariaDB-only, so my_bool is available there. */
#ifdef MYSQL_OPT_SSL_ENFORCE
        {
            my_bool enforce = (mode != MYSQL_SSL_DISABLED) ? 1 : 0;
            mysql_options(c->db, MYSQL_OPT_SSL_ENFORCE, &enforce);
        }
#endif
#ifdef MYSQL_OPT_SSL_VERIFY_SERVER_CERT
        {
            my_bool verify =
                (mode == MYSQL_SSL_VERIFY_CA || mode == MYSQL_SSL_VERIFY_IDENTITY)
                    ? 1 : 0;
            mysql_options(c->db, MYSQL_OPT_SSL_VERIFY_SERVER_CERT, &verify);
        }
#endif
    }
    return 0;
}

dbc_status mysql_drv_connect(const char *dsn_json, dbc_conn **out)
{
    *out = NULL;
    dbc_conn *c = calloc(1, sizeof *c);
    if (c == NULL) {
        return DBC_ERR_CONN;
    }

    c->db = mysql_init(NULL);
    if (c->db == NULL) {
        set_err(c, "mysql_init failed (out of memory)");
        *out = c;
        return DBC_ERR_CONN;
    }

    cJSON *root = dsn_json != NULL ? cJSON_Parse(dsn_json) : NULL;
    if (root == NULL) {
        set_err(c, "dsn must be a JSON object");
        *out = c;
        return DBC_ERR_PARAM;
    }

    int oom = 0;
    char *host = dup_string(root, "host", &oom);
    char *user = dup_string(root, "user", &oom);
    char *password = dup_string(root, "password", &oom);
    char *database = dup_string(root, "database", &oom);
    char *socket = dup_string(root, "socket", &oom);

    unsigned int port = 0;
    const cJSON *port_item = cJSON_GetObjectItemCaseSensitive(root, "port");
    if (cJSON_IsNumber(port_item) && port_item->valueint > 0) {
        port = (unsigned int)port_item->valueint;
    }

    /* TLS options must be set on the handle before mysql_real_connect. */
    int ssl_rc = configure_ssl(c, root);
    cJSON_Delete(root);
    if (ssl_rc != 0) {
        free(host);
        free(user);
        free(password);
        free(database);
        free(socket);
        *out = c; /* error reason already stashed by configure_ssl */
        return DBC_ERR_PARAM;
    }

    if (oom) {
        /* A provided field could not be copied; fail rather than connect with a
           silently-defaulted parameter. */
        free(host);
        free(user);
        free(password);
        free(database);
        free(socket);
        set_err(c, "out of memory parsing dsn");
        *out = c;
        return DBC_ERR_NOMEM;
    }

    MYSQL *rc = mysql_real_connect(c->db, host, user, password, database, port,
                                   socket, 0);
    free(host);
    free(user);
    free(password);
    free(database);
    free(socket);

    if (rc == NULL) {
        set_err(c, mysql_error(c->db));
        *out = c;
        return DBC_ERR_CONN;
    }

    *out = c;
    return DBC_OK;
}

void mysql_drv_disconnect(dbc_conn *c)
{
    if (c == NULL) {
        return;
    }
    if (c->db != NULL) {
        mysql_close(c->db);
    }
    free(c);
}

const char *mysql_drv_last_error(dbc_conn *c)
{
    if (c == NULL) {
        return "";
    }
    if (c->err[0] != '\0') {
        return c->err;
    }
    return c->db != NULL ? mysql_error(c->db) : "";
}
