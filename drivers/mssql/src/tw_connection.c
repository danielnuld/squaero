#include "internal.h"
#include "utils/options.h"

#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Connection lifecycle over libtdswire (issue #584), the backend of the iOS
 * build: the same DSN as connection.c,
 *
 *   { "host": "127.0.0.1", "port": "1433", "instance": "SQLEXPRESS",
 *     "user": "sa", "password": "secret", "database": "app",
 *     "encryption": "require" }
 *
 * `encryption` off and request encrypt the login only unless the server asks
 * for more, as FreeTDS does; require encrypts the whole session or refuses to
 * connect; strict (TDS 8) is not supported by libtdswire yet and says so.
 */

static void copy_err(char *buf, size_t cap, const char *msg)
{
    snprintf(buf, cap, "%s", msg != NULL ? msg : "");
}

static const char *field_str(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(item) || item->valuestring == NULL || item->valuestring[0] == '\0') {
        return NULL;
    }
    return item->valuestring;
}

/* `port` from a string (what the frontend sends) or a JSON number; 0 when
   absent or invalid. */
static int field_port(const cJSON *root)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, "port");
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

static dbc_status open_connection(dbc_conn *c, const cJSON *root)
{
    tw_options o;
    memset(&o, 0, sizeof o);
    o.host = field_str(root, "host");
    o.user = field_str(root, "user");
    if (o.host == NULL || o.user == NULL) {
        copy_err(c->err, sizeof c->err, "dsn needs 'host' and 'user'");
        return DBC_ERR_PARAM;
    }
    const char *encryption = mssql_encryption_option(field_str(root, "encryption"));
    if (encryption == NULL) {
        copy_err(c->err, sizeof c->err, "encryption must be off, request, require or strict");
        return DBC_ERR_PARAM;
    }
    if (strcmp(encryption, "strict") == 0) {
        copy_err(c->err, sizeof c->err,
                 "encryption strict (TDS 8) is not supported yet on this device: use require");
        return DBC_ERR_UNSUPPORTED;
    }
    o.encrypt = strcmp(encryption, "require") == 0 ? TW_ENCRYPT_REQUIRE : TW_ENCRYPT_LOGIN;
    o.instance = field_str(root, "instance");
    o.port = field_port(root);
    if (o.instance != NULL && o.port != 0) {
        copy_err(c->err, sizeof c->err, "give either 'port' or 'instance', not both");
        return DBC_ERR_PARAM;
    }
    o.password = field_str(root, "password");
    o.database = field_str(root, "database");
    o.app = "quaero";
    c->tw = tw_connect(&o, c->err, (int)sizeof c->err);
    return c->tw != NULL ? DBC_OK : DBC_ERR_CONN;
}

dbc_status ms_drv_connect(const char *dsn_json, dbc_conn **out)
{
    *out = NULL;
    dbc_conn *c = calloc(1, sizeof *c);
    if (c == NULL) {
        return DBC_ERR_NOMEM;
    }
    *out = c; /* even on failure: the core reads last_error, then disconnects */
    cJSON *root = dsn_json != NULL ? cJSON_Parse(dsn_json) : NULL;
    if (root == NULL) {
        copy_err(c->err, sizeof c->err, "dsn must be a JSON object");
        return DBC_ERR_PARAM;
    }
    dbc_status st = open_connection(c, root);
    cJSON_Delete(root);
    return st;
}

void ms_drv_disconnect(dbc_conn *c)
{
    if (c == NULL) {
        return;
    }
    tw_close(c->tw);
    free(c);
}

const char *ms_drv_last_error(dbc_conn *c)
{
    if (c == NULL) {
        return "";
    }
    return c->err[0] != '\0' ? c->err : "";
}

dbc_status ms_drv_cancel(dbc_conn *c)
{
    if (c == NULL || c->tw == NULL) {
        return DBC_ERR_PARAM;
    }
    return tw_cancel(c->tw) == 0 ? DBC_OK : DBC_ERR_CONN;
}
