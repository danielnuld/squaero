#include "internal.h"

#include "cJSON.h"

#include <stdlib.h>
#include <string.h>

/*
 * Connection lifecycle for the MongoDB driver over the mongo-c-driver. The DSN
 * arrives as JSON:
 *
 *   { "host": "127.0.0.1", "port": 27017, "user": "app", "password": "secret",
 *     "database": "shop", "auth_source": "admin", "tls": "true" }
 *
 * or, alternatively, a ready-made connection string:
 *
 *   { "uri": "mongodb+srv://user:pass@cluster.example.net/shop" }
 *
 * When "uri" is present it takes precedence and the rest are ignored (the string
 * already carries them). All fields are optional otherwise; host/port default to
 * 127.0.0.1:27017. The connection is validated with a `ping` command so connect
 * fails loudly on a bad host/credentials rather than lazily on first query. On
 * failure connect still returns the (error-state) handle so the core can read
 * last_error before disconnecting it. The engine-agnostic SSH tunnel is handled
 * in the core (issue #76), transparently to this driver.
 */

/* mongoc_init must run once before any other mongoc call. Connections in this
   app are opened one at a time from the UI, so a plain guard is sufficient. */
static int g_mongoc_inited = 0;

static void ensure_mongoc_init(void)
{
    if (!g_mongoc_inited) {
        mongoc_init();
        g_mongoc_inited = 1;
    }
}

void mongo_set_err(dbc_conn *c, const char *msg)
{
    if (c == NULL) {
        return;
    }
    if (msg == NULL) {
        msg = "unknown error";
    }
    size_t n = strlen(msg);
    if (n >= sizeof c->err) {
        n = sizeof c->err - 1;
    }
    memcpy(c->err, msg, n);
    c->err[n] = '\0';
}

void mongo_stash_bson_error(dbc_conn *c, const char *ctx, const bson_error_t *error)
{
    if (c == NULL) {
        return;
    }
    const char *detail = (error != NULL && error->message[0] != '\0')
                             ? error->message : "operation failed";
    if (ctx != NULL && ctx[0] != '\0') {
        snprintf(c->err, sizeof c->err, "%s: %s", ctx, detail);
    } else {
        mongo_set_err(c, detail);
    }
}

/* Owned copy of a C string (strdup is not ISO C, so avoid it under -std=c11). */
static char *dup_cstr(const char *s)
{
    if (s == NULL) {
        return NULL;
    }
    size_t n = strlen(s) + 1;
    char *p = malloc(n);
    if (p != NULL) {
        memcpy(p, s, n);
    }
    return p;
}

/* Owned copy of a DSN string field, or NULL when absent/empty. *oom is set when
   the field is present but cannot be copied. */
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

/* Accept a port given as a JSON number or a numeric string (the frontend sends
   DSN values as strings). Returns 0 when unset/invalid so the URI default holds. */
static uint16_t parse_port(const cJSON *root)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, "port");
    if (cJSON_IsNumber(item) && item->valueint > 0 && item->valueint <= 65535) {
        return (uint16_t)item->valueint;
    }
    if (cJSON_IsString(item) && item->valuestring != NULL) {
        char *end = NULL;
        long v = strtol(item->valuestring, &end, 10);
        if (end != item->valuestring && *end == '\0' && v > 0 && v <= 65535) {
            return (uint16_t)v;
        }
    }
    return 0;
}

/* A DSN field is truthy when it is JSON true or the string "true"/"1". */
static int field_is_true(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (cJSON_IsBool(item)) {
        return cJSON_IsTrue(item);
    }
    if (cJSON_IsString(item) && item->valuestring != NULL) {
        return strcmp(item->valuestring, "true") == 0 ||
               strcmp(item->valuestring, "1") == 0;
    }
    return 0;
}

/* Build the mongoc URI from the DSN object. On success returns the URI and, when
   the DSN names a default database, an owned copy via *db_out. On failure returns
   NULL with a reason stashed on c. */
static mongoc_uri_t *build_uri(dbc_conn *c, const cJSON *root, char **db_out)
{
    *db_out = NULL;
    int oom = 0;

    char *full = dup_string(root, "uri", &oom);
    if (full != NULL) {
        bson_error_t berr;
        mongoc_uri_t *uri = mongoc_uri_new_with_error(full, &berr);
        free(full);
        if (uri == NULL) {
            mongo_stash_bson_error(c, "invalid connection uri", &berr);
            return NULL;
        }
        const char *dbn = mongoc_uri_get_database(uri);
        if (dbn != NULL) {
            *db_out = dup_cstr(dbn);
        }
        return uri;
    }

    char *host = dup_string(root, "host", &oom);
    char *user = dup_string(root, "user", &oom);
    char *password = dup_string(root, "password", &oom);
    char *database = dup_string(root, "database", &oom);
    char *auth_source = dup_string(root, "auth_source", &oom);
    uint16_t port = parse_port(root);
    if (oom) {
        free(host); free(user); free(password); free(database); free(auth_source);
        mongo_set_err(c, "out of memory parsing dsn");
        return NULL;
    }

    mongoc_uri_t *uri = mongoc_uri_new_for_host_port(
        host != NULL ? host : "127.0.0.1", port != 0 ? port : 27017);
    if (uri == NULL) {
        free(host); free(user); free(password); free(database); free(auth_source);
        mongo_set_err(c, "could not build connection uri");
        return NULL;
    }
    if (user != NULL) {
        mongoc_uri_set_username(uri, user);
    }
    if (password != NULL) {
        mongoc_uri_set_password(uri, password);
    }
    if (database != NULL) {
        mongoc_uri_set_database(uri, database);
        *db_out = dup_cstr(database);
    }
    if (auth_source != NULL) {
        mongoc_uri_set_auth_source(uri, auth_source);
    }
    if (field_is_true(root, "tls") || field_is_true(root, "ssl")) {
        mongoc_uri_set_option_as_bool(uri, MONGOC_URI_TLS, true);
    }

    free(host); free(user); free(password); free(database); free(auth_source);
    return uri;
}

dbc_status mongo_connect(const char *dsn_json, dbc_conn **out)
{
    *out = NULL;
    ensure_mongoc_init();

    dbc_conn *c = calloc(1, sizeof *c);
    if (c == NULL) {
        return DBC_ERR_CONN;
    }

    cJSON *root = dsn_json != NULL ? cJSON_Parse(dsn_json) : NULL;
    if (root == NULL) {
        mongo_set_err(c, "dsn must be a JSON object");
        *out = c;
        return DBC_ERR_PARAM;
    }

    mongoc_uri_t *uri = build_uri(c, root, &c->db);
    cJSON_Delete(root);
    if (uri == NULL) {
        *out = c; /* reason already stashed */
        return DBC_ERR_CONN;
    }

    c->client = mongoc_client_new_from_uri(uri);
    mongoc_uri_destroy(uri);
    if (c->client == NULL) {
        mongo_set_err(c, "could not create mongo client");
        *out = c;
        return DBC_ERR_CONN;
    }
    mongoc_client_set_appname(c->client, "quaero");

    /* Validate connectivity + auth up front with a ping against admin. */
    bson_t *ping = BCON_NEW("ping", BCON_INT32(1));
    bson_error_t berr;
    bool ok = mongoc_client_command_simple(c->client, "admin", ping, NULL, NULL,
                                           &berr);
    bson_destroy(ping);
    if (!ok) {
        mongo_stash_bson_error(c, "connection failed", &berr);
        *out = c;
        return DBC_ERR_CONN;
    }

    *out = c;
    return DBC_OK;
}

void mongo_disconnect(dbc_conn *c)
{
    if (c == NULL) {
        return;
    }
    if (c->client != NULL) {
        mongoc_client_destroy(c->client);
    }
    free(c->db);
    free(c);
}

const char *mongo_last_error(dbc_conn *c)
{
    if (c == NULL) {
        return "";
    }
    return c->err;
}
