#include "internal.h"

#include "cJSON.h"

#include <stdlib.h>
#include <string.h>

/*
 * Connection lifecycle for the MySQL/MariaDB driver. The DSN arrives as JSON:
 *
 *   { "host": "127.0.0.1", "port": 3306, "user": "root",
 *     "password": "secret", "database": "app", "socket": "/var/run/mysqld.sock" }
 *
 * All fields are optional; the client library applies its own defaults. On any
 * failure connect still returns the (error-state) handle so the core can read
 * last_error before disconnecting it. Secure transport (SSL / SSH tunnel) is a
 * separate milestone task (#24) and is not configured here.
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
    cJSON_Delete(root);

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
