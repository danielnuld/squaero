#include "internal.h"

#include "cJSON.h"

#include <stdlib.h>
#include <string.h>

/*
 * Connection lifecycle for the SQLite driver. The DSN arrives as JSON; SQLite
 * needs only a database path:
 *
 *   { "path": "/var/data/app.db" }   or   { "path": ":memory:" }
 *
 * On any failure connect still returns the (error-state) handle so the core can
 * read last_error before disconnecting it.
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

/* Extract a copy of the "path" string from the DSN JSON, or NULL if absent. */
static char *dsn_path(const char *dsn_json)
{
    if (dsn_json == NULL) {
        return NULL;  /* cJSON_Parse(NULL) would strlen(NULL); guard it */
    }
    cJSON *root = cJSON_Parse(dsn_json);
    if (root == NULL) {
        return NULL;
    }
    char *path = NULL;
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, "path");
    if (cJSON_IsString(item) && item->valuestring != NULL) {
        size_t n = strlen(item->valuestring) + 1;
        path = malloc(n);
        if (path != NULL) {
            memcpy(path, item->valuestring, n);
        }
    }
    cJSON_Delete(root);
    return path;
}

dbc_status sqlite_connect(const char *dsn_json, dbc_conn **out)
{
    *out = NULL;
    dbc_conn *c = calloc(1, sizeof *c);
    if (c == NULL) {
        return DBC_ERR_CONN;  /* no handle -> core reports a generic message */
    }

    char *path = dsn_path(dsn_json);
    if (path == NULL) {
        set_err(c, "dsn must be a JSON object with a \"path\" string");
        *out = c;
        return DBC_ERR_PARAM;
    }

    int rc = sqlite3_open(path, &c->db);
    free(path);
    if (rc != SQLITE_OK) {
        set_err(c, c->db != NULL ? sqlite3_errmsg(c->db) : "out of memory");
        *out = c;
        return DBC_ERR_CONN;
    }

    *out = c;
    return DBC_OK;
}

void sqlite_disconnect(dbc_conn *c)
{
    if (c == NULL) {
        return;
    }
    sqlite3_close(c->db);
    free(c);
}

const char *sqlite_last_error(dbc_conn *c)
{
    if (c == NULL) {
        return "";
    }
    /* A stashed message (e.g. a bad DSN, when there is no usable db) wins;
       otherwise SQLite's own most-recent error on the connection. */
    if (c->err[0] != '\0') {
        return c->err;
    }
    return c->db != NULL ? sqlite3_errmsg(c->db) : "";
}
