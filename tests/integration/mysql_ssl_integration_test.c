/*
 * MySQL/MariaDB SSL integration test: opens a connection with ssl_mode=required
 * and proves the transport is actually encrypted by reading the session's
 * Ssl_cipher status variable (non-empty only over TLS).
 *
 * The DSN is read from QUAERO_MYSQL_SSL_DSN (a JSON object that must include
 * "ssl_mode":"required"); when unset the test SKIPS. CI points it at a
 * TLS-enabled MariaDB service.
 *
 * Built only when the MySQL driver is present. MYSQL_PLUGIN_PATH is injected by
 * CMake as the built plugin's full path.
 */
#include "dbcore/ipc.h"
#include "dbcore/loader.h"
#include "dbcore/runtime.h"

#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static cJSON *call(const char *request)
{
    char *resp = dbcore_ipc_handle(request);
    cJSON *root = cJSON_Parse(resp);
    dbcore_ipc_free(resp);
    return root;
}

static cJSON *result_of(cJSON *root)
{
    return cJSON_GetObjectItem(root, "result");
}

int main(void)
{
    const char *dsn = getenv("QUAERO_MYSQL_SSL_DSN");
    if (dsn == NULL || dsn[0] == '\0') {
        printf("SKIP: QUAERO_MYSQL_SSL_DSN not set; MySQL SSL test skipped\n");
        return 0;
    }

    char err[256];
    dbc_plugin *plugin = NULL;
    dbc_status st = dbc_plugin_load(MYSQL_PLUGIN_PATH, &plugin, err, sizeof err);
    EXPECT(st == DBC_OK, "load the MySQL plugin");
    if (st != DBC_OK) {
        fprintf(stderr, "could not load %s: %s\n", MYSQL_PLUGIN_PATH, err);
        return 1;
    }
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    dbcore_runtime_reset();
    dbcore_runtime_register_driver(dbcore_runtime_get(), drv);

    char conn_id[32] = {0};
    {
        char req[2048];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                 "\"params\":{\"driver\":\"mysql\",\"dsn\":%s}}",
                 dsn);
        cJSON *root = call(req);
        cJSON *cid = cJSON_GetObjectItem(result_of(root), "connId");
        EXPECT(cJSON_IsString(cid), "conn.open with ssl_mode=required succeeds");
        if (cJSON_IsString(cid)) {
            snprintf(conn_id, sizeof conn_id, "%s", cid->valuestring);
        } else {
            cJSON *e = cJSON_GetObjectItem(root, "error");
            if (e) {
                cJSON *m = cJSON_GetObjectItem(e, "message");
                fprintf(stderr, "conn.open error: %s\n",
                        cJSON_IsString(m) ? m->valuestring : "?");
            }
        }
        cJSON_Delete(root);
    }
    if (conn_id[0] == '\0') {
        dbcore_runtime_reset();
        dbc_plugin_unload(plugin);
        return 1;
    }

    /* Diagnostic: does the server even offer TLS? (YES vs DISABLED) */
    {
        char req[512];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"query.run\","
                 "\"params\":{\"connId\":\"%s\","
                 "\"sql\":\"SHOW GLOBAL VARIABLES LIKE 'have_ssl'\"}}",
                 conn_id);
        cJSON *root = call(req);
        cJSON *rows = cJSON_GetObjectItem(result_of(root), "rows");
        cJSON *v = cJSON_GetArrayItem(cJSON_GetArrayItem(rows, 0), 1);
        fprintf(stderr, "server have_ssl = %s\n",
                cJSON_IsString(v) ? v->valuestring : "?");
        cJSON_Delete(root);
    }

    /* Ssl_cipher is empty on a plaintext connection and a cipher name over TLS. */
    {
        char req[512];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"query.run\","
                 "\"params\":{\"connId\":\"%s\","
                 "\"sql\":\"SHOW SESSION STATUS LIKE 'Ssl_cipher'\"}}",
                 conn_id);
        cJSON *root = call(req);
        cJSON *rows = cJSON_GetObjectItem(result_of(root), "rows");
        EXPECT(cJSON_GetArraySize(rows) == 1, "one status row");
        cJSON *value = cJSON_GetArrayItem(cJSON_GetArrayItem(rows, 0), 1);
        EXPECT(cJSON_IsString(value) && value->valuestring[0] != '\0',
               "Ssl_cipher is non-empty (connection is encrypted)");
        if (cJSON_IsString(value)) {
            fprintf(stderr, "Ssl_cipher = %s\n", value->valuestring);
        }
        cJSON_Delete(root);
    }

    {
        char req[256];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"conn.close\","
                 "\"params\":{\"connId\":\"%s\"}}",
                 conn_id);
        cJSON *root = call(req);
        cJSON_Delete(root);
    }

    dbcore_runtime_reset();
    dbc_plugin_unload(plugin);

    if (failures == 0) {
        printf("OK: MySQL SSL integration (encrypted connection verified)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
