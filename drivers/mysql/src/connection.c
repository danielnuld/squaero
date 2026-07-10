#include "internal.h"
#include "utils/ssl.h"

#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#endif

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

/* Copy a NUL-terminated reason into a fixed buffer (truncating if needed). Used
   both for the connection's stashed error and for the killer connection's local
   scratch, so it takes a plain buffer rather than a dbc_conn. */
static void copy_err(char *buf, size_t cap, const char *msg)
{
    if (buf == NULL || cap == 0) {
        return;
    }
    size_t n = strlen(msg);
    if (n >= cap) {
        n = cap - 1;
    }
    memcpy(buf, msg, n);
    buf[n] = '\0';
}

/* Point the MySQL client at its authentication-plugin directory. On Windows the
   bundled libmysql.dll resolves plugins (mysql_native_password, caching_sha2_
   password, …) from a directory it computes at connect time; because we stage
   libmysql.dll next to the executable — away from its original install — that
   default no longer resolves and every connection fails with "Authentication
   plugin '…' cannot be loaded". We point it at the plugin folder staged beside
   this driver DLL (<driver_dir>/mysql-plugin). An explicit LIBMYSQL_PLUGIN_DIR
   in the environment, which the client already honors, always wins. On other
   platforms the MariaDB connector ships these plugins built in, so this is a
   no-op. */
static void configure_plugin_dir(MYSQL *db)
{
#if defined(_WIN32)
    static const char anchor = 0;   /* an address inside this module */
    static const char suffix[] = "\\mysql-plugin";
    const char *env;
    HMODULE self = NULL;
    DWORD n;
    char path[MAX_PATH];
    size_t len;

    env = getenv("LIBMYSQL_PLUGIN_DIR");
    if (env != NULL && env[0] != '\0') {
        return;                     /* explicit override wins */
    }
    if (!GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS
                                | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            &anchor, &self)) {
        return;
    }
    n = GetModuleFileNameA(self, path, (DWORD)sizeof path);
    if (n == 0 || n >= sizeof path) {
        return;
    }
    /* Strip the DLL filename, leaving the driver directory (no trailing sep). */
    while (n > 0 && path[n - 1] != '\\' && path[n - 1] != '/') {
        --n;
    }
    if (n == 0) {
        return;
    }
    path[n - 1] = '\0';
    len = strlen(path);
    if (len + sizeof suffix > sizeof path) {
        return;
    }
    memcpy(path + len, suffix, sizeof suffix);   /* copies the NUL too */
    mysql_options(db, MYSQL_PLUGIN_DIR, path);
#else
    (void)db;
#endif
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
static int configure_ssl(MYSQL *db, const cJSON *root, char *errbuf, size_t errcap)
{
    int oom = 0;
    char *ca = dup_string(root, "ssl_ca", &oom);
    char *cert = dup_string(root, "ssl_cert", &oom);
    char *key = dup_string(root, "ssl_key", &oom);
    if (oom) {
        free(ca);
        free(cert);
        free(key);
        copy_err(errbuf, errcap, "out of memory parsing ssl dsn fields");
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
        copy_err(errbuf, errcap, "ssl_mode must be disabled, required, verify_ca or "
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
        mysql_ssl_set(db, key, cert, ca, NULL, NULL);
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
        mysql_options(db, MYSQL_OPT_SSL_MODE, &m);
#endif
        /* MariaDB Connector/C honours SSL_MODE inconsistently across versions;
           its native enforcement knobs are MYSQL_OPT_SSL_ENFORCE (encrypt) and
           MYSQL_OPT_SSL_VERIFY_SERVER_CERT (verify the cert). Set them too where
           present — both are MariaDB-only, so my_bool is available there. */
#ifdef MYSQL_OPT_SSL_ENFORCE
        {
            my_bool enforce = (mode != MYSQL_SSL_DISABLED) ? 1 : 0;
            mysql_options(db, MYSQL_OPT_SSL_ENFORCE, &enforce);
        }
#endif
#ifdef MYSQL_OPT_SSL_VERIFY_SERVER_CERT
        {
            my_bool verify =
                (mode == MYSQL_SSL_VERIFY_CA || mode == MYSQL_SSL_VERIFY_IDENTITY)
                    ? 1 : 0;
            mysql_options(db, MYSQL_OPT_SSL_VERIFY_SERVER_CERT, &verify);
        }
#endif
    }
    return 0;
}

/*
 * Parse the DSN, extract the connection parameters, configure TLS and connect
 * `db`. Copies a reason into errbuf on failure and returns the status; `db` is
 * left for the caller to close. Shared by mysql_drv_connect and the cancel-time
 * killer connection, so both are configured identically (including TLS and the
 * SSH-tunnel-rewritten host/port). `db` must be mysql_init'd by the caller.
 */
static dbc_status connect_handle(MYSQL *db, const char *dsn_json,
                                 char *errbuf, size_t errcap)
{
    cJSON *root = dsn_json != NULL ? cJSON_Parse(dsn_json) : NULL;
    if (root == NULL) {
        copy_err(errbuf, errcap, "dsn must be a JSON object");
        return DBC_ERR_PARAM;
    }

    int oom = 0;
    char *host = dup_string(root, "host", &oom);
    char *user = dup_string(root, "user", &oom);
    char *password = dup_string(root, "password", &oom);
    char *database = dup_string(root, "database", &oom);
    char *socket = dup_string(root, "socket", &oom);

    /* The frontend sends DSN values as strings, so accept a numeric-string port
       as well as a JSON number (matching the core's ssh_config int_field). */
    unsigned int port = 0;
    const cJSON *port_item = cJSON_GetObjectItemCaseSensitive(root, "port");
    if (cJSON_IsNumber(port_item) && port_item->valueint > 0) {
        port = (unsigned int)port_item->valueint;
    } else if (cJSON_IsString(port_item) && port_item->valuestring != NULL) {
        char *end = NULL;
        long v = strtol(port_item->valuestring, &end, 10);
        if (end != port_item->valuestring && *end == '\0' && v > 0 && v <= 65535) {
            port = (unsigned int)v;
        }
    }

    /* TLS options must be set on the handle before mysql_real_connect. */
    int ssl_rc = configure_ssl(db, root, errbuf, errcap);
    cJSON_Delete(root);

    dbc_status st = DBC_OK;
    if (ssl_rc != 0) {
        st = DBC_ERR_PARAM; /* reason already copied by configure_ssl */
    } else if (oom) {
        /* A provided field could not be copied; fail rather than connect with a
           silently-defaulted parameter. */
        copy_err(errbuf, errcap, "out of memory parsing dsn");
        st = DBC_ERR_NOMEM;
    } else if (mysql_real_connect(db, host, user, password, database, port,
                                  socket, 0) == NULL) {
        copy_err(errbuf, errcap, mysql_error(db));
        st = DBC_ERR_CONN;
    }

    free(host);
    free(user);
    free(password);
    free(database);
    free(socket);
    return st;
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
        copy_err(c->err, sizeof c->err, "mysql_init failed (out of memory)");
        *out = c;
        return DBC_ERR_CONN;
    }

    configure_plugin_dir(c->db);

    dbc_status st = connect_handle(c->db, dsn_json, c->err, sizeof c->err);
    if (st != DBC_OK) {
        *out = c; /* error reason already stashed in c->err */
        return st;
    }

    /* Remember what a later cancel needs: the server thread id to KILL, and a
       copy of the (already tunnel-rewritten) DSN so the killer connection is
       configured identically. Driver-local — never copied into the core. If the
       DSN copy fails, cancel simply reports unsupported rather than misbehaving. */
    c->thread_id = mysql_thread_id(c->db);
    if (dsn_json != NULL) {
        size_t n = strlen(dsn_json) + 1;
        c->dsn = malloc(n);
        if (c->dsn != NULL) {
            memcpy(c->dsn, dsn_json, n);
        }
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
    free(c->dsn);
    free(c);
}

/*
 * Interrupt the query running on c (DBC_FEAT_CANCEL). A MYSQL connection cannot
 * be used from two threads at once, so cancel cannot touch c->db (the worker
 * thread is inside mysql_real_query on it). Instead it opens a short-lived side
 * connection — configured identically from the stored DSN — and issues
 * "KILL QUERY <thread_id>", which makes the running statement fail with
 * ER_QUERY_INTERRUPTED (surfaced as a query error by mysql_drv_query). It reads
 * only c->dsn and c->thread_id, both immutable after connect, so it is safe to
 * run concurrently with the query. mysql_thread_init/end bracket the library use
 * on this (foreign) thread.
 */
dbc_status mysql_drv_cancel(dbc_conn *c)
{
    if (c == NULL || c->dsn == NULL || c->thread_id == 0) {
        return DBC_ERR_UNSUPPORTED;
    }

    mysql_thread_init();

    dbc_status st = DBC_ERR_UNSUPPORTED;
    MYSQL *killer = mysql_init(NULL);
    if (killer != NULL) {
        configure_plugin_dir(killer);
        char errbuf[512];
        if (connect_handle(killer, c->dsn, errbuf, sizeof errbuf) == DBC_OK) {
            char sql[64];
            snprintf(sql, sizeof sql, "KILL QUERY %lu", c->thread_id);
            if (mysql_query(killer, sql) == 0) {
                st = DBC_OK;
            }
        }
        mysql_close(killer);
    }

    mysql_thread_end();
    return st;
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
