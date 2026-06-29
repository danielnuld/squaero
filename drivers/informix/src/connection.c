#include "internal.h"
#include "utils/connstr.h"

#include "cJSON.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/*
 * Connection lifecycle for the Informix driver over ODBC. The DSN arrives as
 * JSON; two shapes are accepted (see utils/connstr.h):
 *
 *   driver-direct (no sqlhosts entry needed):
 *     { "host": "10.0.0.5", "port": 1526, "server": "ol_informix1210",
 *       "database": "stores", "user": "informix", "password": "secret",
 *       "protocol": "onsoctcp" }
 *
 *   pre-configured ODBC data source:
 *     { "odbc_dsn": "stores_demo", "user": "informix", "password": "secret" }
 *
 * `service` (a TCP port number or /etc/services name) may be given instead of
 * `port`; `driver` overrides the default registered driver name. On any failure
 * connect still returns the (error-state) handle so the core can read
 * last_error before disconnecting. The engine-agnostic SSH tunnel is handled in
 * the core (issue #76), transparently to this driver.
 */

void ifx_set_err(dbc_conn *c, const char *msg)
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

void ifx_stash_diag(dbc_conn *c, SQLSMALLINT htype, SQLHANDLE h, const char *ctx)
{
    if (c == NULL) {
        return;
    }

    /* Concatenate the diagnostic records: "<ctx>: [SQLSTATE] message; ...". */
    int pos = snprintf(c->err, sizeof c->err, "%s", ctx != NULL ? ctx : "error");
    if (pos < 0) {
        c->err[0] = '\0';
        return;
    }

    SQLSMALLINT rec = 1;
    SQLCHAR     state[6];
    SQLINTEGER  native;
    SQLCHAR     msg[512];
    SQLSMALLINT msg_len;
    while ((size_t)pos < sizeof c->err &&
           SQLGetDiagRec(htype, h, rec, state, &native, msg, sizeof msg,
                         &msg_len) == SQL_SUCCESS) {
        int n = snprintf(c->err + pos, sizeof c->err - (size_t)pos,
                         "%s[%s] %s", rec == 1 ? ": " : "; ",
                         (const char *)state, (const char *)msg);
        if (n < 0) {
            break;
        }
        pos += n;
        rec++;
    }
    if (rec == 1) {
        /* No diagnostic records were available. */
        snprintf(c->err, sizeof c->err, "%s: no diagnostic available",
                 ctx != NULL ? ctx : "error");
    }
}

/* Borrowed (not copied) string field of root, or NULL when absent/empty. */
static const char *str_field(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(item) || item->valuestring == NULL ||
        item->valuestring[0] == '\0') {
        return NULL;
    }
    return item->valuestring;
}

dbc_status ifx_connect(const char *dsn_json, dbc_conn **out)
{
    *out = NULL;
    dbc_conn *c = calloc(1, sizeof *c);
    if (c == NULL) {
        return DBC_ERR_NOMEM;
    }

    if (SQLAllocHandle(SQL_HANDLE_ENV, SQL_NULL_HANDLE, &c->env) != SQL_SUCCESS) {
        ifx_set_err(c, "SQLAllocHandle(ENV) failed");
        *out = c;
        return DBC_ERR_CONN;
    }
    SQLSetEnvAttr(c->env, SQL_ATTR_ODBC_VERSION, (SQLPOINTER)SQL_OV_ODBC3, 0);
    if (SQLAllocHandle(SQL_HANDLE_DBC, c->env, &c->dbc) != SQL_SUCCESS) {
        ifx_stash_diag(c, SQL_HANDLE_ENV, c->env, "SQLAllocHandle(DBC)");
        *out = c;
        return DBC_ERR_CONN;
    }

    cJSON *root = dsn_json != NULL ? cJSON_Parse(dsn_json) : NULL;
    if (root == NULL) {
        ifx_set_err(c, "dsn must be a JSON object");
        *out = c;
        return DBC_ERR_PARAM;
    }

    /* A numeric "port" is accepted as an alternative to a "service" string. */
    char port_buf[16];
    const char *service = str_field(root, "service");
    if (service == NULL) {
        const cJSON *port_item = cJSON_GetObjectItemCaseSensitive(root, "port");
        if (cJSON_IsNumber(port_item) && port_item->valueint > 0) {
            snprintf(port_buf, sizeof port_buf, "%d", port_item->valueint);
            service = port_buf;
        }
    }

    struct informix_conn_params p = {
        .driver   = str_field(root, "driver"),
        .odbc_dsn = str_field(root, "odbc_dsn"),
        .host     = str_field(root, "host"),
        .service  = service,
        .server   = str_field(root, "server"),
        .protocol = str_field(root, "protocol"),
        .database = str_field(root, "database"),
        .user     = str_field(root, "user"),
        .password = str_field(root, "password"),
    };

    char conn_str[2048];
    int len = informix_build_conn_str(&p, conn_str, sizeof conn_str);
    cJSON_Delete(root);
    if (len < 0) {
        ifx_set_err(c, "dsn needs either 'odbc_dsn' or 'host'+'port'/'service'"
                       "+'server' (connection string too long otherwise)");
        *out = c;
        return DBC_ERR_PARAM;
    }

    SQLRETURN rc = SQLDriverConnect(c->dbc, NULL, (SQLCHAR *)conn_str, SQL_NTS,
                                    NULL, 0, NULL, SQL_DRIVER_NOPROMPT);
    if (rc != SQL_SUCCESS && rc != SQL_SUCCESS_WITH_INFO) {
        ifx_stash_diag(c, SQL_HANDLE_DBC, c->dbc, "connect");
        *out = c;
        return DBC_ERR_CONN;
    }

    c->connected = 1;
    *out = c;
    return DBC_OK;
}

void ifx_disconnect(dbc_conn *c)
{
    if (c == NULL) {
        return;
    }
    if (c->dbc != NULL) {
        if (c->connected) {
            SQLDisconnect(c->dbc);
        }
        SQLFreeHandle(SQL_HANDLE_DBC, c->dbc);
    }
    if (c->env != NULL) {
        SQLFreeHandle(SQL_HANDLE_ENV, c->env);
    }
    free(c);
}

const char *ifx_last_error(dbc_conn *c)
{
    if (c == NULL) {
        return "";
    }
    return c->err;
}
