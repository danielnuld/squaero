#include "internal.h"

#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Connection lifecycle for the PostgreSQL driver. The DSN arrives as JSON:
 *
 *   { "host": "127.0.0.1", "port": 5432, "user": "postgres",
 *     "password": "secret", "database": "app",
 *     "sslmode": "require", "sslrootcert": "...", "sslcert": "...", "sslkey": "..." }
 *
 * All fields are optional; libpq applies its own defaults (and reads PG* env
 * vars / .pgpass as usual). Parameters are handed to PQconnectdbParams as a
 * keyword/value array, so no connection-string escaping is needed. On failure
 * connect still returns the (error-state) handle so the core can read last_error
 * before disconnecting it. The engine-agnostic SSH tunnel is handled in the core
 * (issue #76), transparently to this driver.
 */

/* Copy a NUL-terminated reason into a fixed buffer (truncating if needed). */
static void copy_err(char *buf, size_t cap, const char *msg)
{
    if (buf == NULL || cap == 0) {
        return;
    }
    if (msg == NULL) {
        msg = "";
    }
    size_t n = strlen(msg);
    if (n >= cap) {
        n = cap - 1;
    }
    memcpy(buf, msg, n);
    buf[n] = '\0';
}

/* Value of a string DSN field, or NULL when absent/empty. Borrowed from the
   parsed cJSON tree — valid until the tree is freed. */
static const char *field_str(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(item) || item->valuestring == NULL ||
        item->valuestring[0] == '\0') {
        return NULL;
    }
    return item->valuestring;
}

/* Append a keyword/value pair when `value` is non-NULL. `n` is the live count of
   filled slots; both arrays must have room for one more plus the NULL terminator. */
static void add_param(const char **keywords, const char **values, int *n,
                      const char *keyword, const char *value)
{
    if (value == NULL) {
        return;
    }
    keywords[*n] = keyword;
    values[*n] = value;
    (*n)++;
}

dbc_status pg_drv_connect(const char *dsn_json, dbc_conn **out)
{
    *out = NULL;
    dbc_conn *c = calloc(1, sizeof *c);
    if (c == NULL) {
        return DBC_ERR_CONN;
    }

    cJSON *root = dsn_json != NULL ? cJSON_Parse(dsn_json) : NULL;
    if (root == NULL) {
        copy_err(c->err, sizeof c->err, "dsn must be a JSON object");
        *out = c;
        return DBC_ERR_PARAM;
    }

    /* The frontend sends every DSN value as a string; libpq accepts port and
       connect_timeout as strings too, so pass them straight through. `database`
       is the neutral key; libpq's keyword is `dbname`. */
    const char *port = field_str(root, "port");
    char port_buf[16];
    const cJSON *port_item = cJSON_GetObjectItemCaseSensitive(root, "port");
    if (port == NULL && cJSON_IsNumber(port_item) && port_item->valueint > 0) {
        snprintf(port_buf, sizeof port_buf, "%d", port_item->valueint);
        port = port_buf;
    }

    /* Fixed-size arrays: at most a dozen keywords, plus the NULL terminator. */
    const char *keywords[16];
    const char *values[16];
    int n = 0;
    add_param(keywords, values, &n, "host", field_str(root, "host"));
    add_param(keywords, values, &n, "port", port);
    add_param(keywords, values, &n, "dbname", field_str(root, "database"));
    add_param(keywords, values, &n, "user", field_str(root, "user"));
    add_param(keywords, values, &n, "password", field_str(root, "password"));
    add_param(keywords, values, &n, "sslmode", field_str(root, "sslmode"));
    add_param(keywords, values, &n, "sslrootcert", field_str(root, "sslrootcert"));
    add_param(keywords, values, &n, "sslcert", field_str(root, "sslcert"));
    add_param(keywords, values, &n, "sslkey", field_str(root, "sslkey"));
    add_param(keywords, values, &n, "connect_timeout",
              field_str(root, "connect_timeout"));
    add_param(keywords, values, &n, "application_name", "quaero");
    keywords[n] = NULL;
    values[n] = NULL;

    c->conn = PQconnectdbParams(keywords, values, 0);
    cJSON_Delete(root);

    if (c->conn == NULL) {
        copy_err(c->err, sizeof c->err, "out of memory establishing connection");
        *out = c;
        return DBC_ERR_CONN;
    }
    if (PQstatus(c->conn) != CONNECTION_OK) {
        /* Stash the reason: last_error reads it after we hand the handle back. */
        copy_err(c->err, sizeof c->err, PQerrorMessage(c->conn));
        *out = c;
        return DBC_ERR_CONN;
    }

    /* Capture a cancel handle now, off the live connection. PQcancel (using this
       object) is documented safe to call from another thread while a query runs
       on c->conn — that is how pg_drv_cancel interrupts without touching it. */
    c->cancel = PQgetCancel(c->conn);

    *out = c;
    return DBC_OK;
}

void pg_drv_disconnect(dbc_conn *c)
{
    if (c == NULL) {
        return;
    }
    if (c->cancel != NULL) {
        PQfreeCancel(c->cancel);
    }
    if (c->conn != NULL) {
        PQfinish(c->conn);
    }
    free(c);
}

/*
 * Interrupt the query running on c (DBC_FEAT_CANCEL). A PGconn cannot be used
 * from two threads at once, so cancel never touches c->conn (the worker thread
 * is inside PQexec on it). Instead it uses the PGcancel object captured at
 * connect — PQcancel is explicitly thread-safe and only reads that immutable
 * object — to ask the backend to abort the current command, which then fails
 * with a query error surfaced by pg_drv_query.
 */
dbc_status pg_drv_cancel(dbc_conn *c)
{
    if (c == NULL || c->cancel == NULL) {
        return DBC_ERR_UNSUPPORTED;
    }
    char errbuf[256];
    /* PQcancel returns 1 when the cancel request was successfully dispatched. */
    return PQcancel(c->cancel, errbuf, (int)sizeof errbuf) == 1
               ? DBC_OK
               : DBC_ERR_QUERY;
}

const char *pg_drv_last_error(dbc_conn *c)
{
    if (c == NULL) {
        return "";
    }
    if (c->err[0] != '\0') {
        return c->err;
    }
    return c->conn != NULL ? PQerrorMessage(c->conn) : "";
}
