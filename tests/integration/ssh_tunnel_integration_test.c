/*
 * SSH-tunnel integration test: the core opens a MySQL/MariaDB connection through
 * an SSH port-forward and runs a query over it, driven through the public
 * JSON-RPC dispatcher (conn.open -> query.run -> conn.close).
 *
 * The whole DSN — including the ssh_* fields that switch the engine-agnostic
 * tunnel on — is read from QUAERO_SSH_DSN (a JSON object). When it is unset the
 * test SKIPS (exit 0), so it is harmless anywhere a tunnel target is not wired
 * up. CI sets it to SSH into the runner's own sshd and forward to the MariaDB
 * service container.
 *
 * Built only when both the MySQL driver and QUAERO_SSH are present. MYSQL_PLUGIN_PATH
 * is injected by CMake as the built plugin's full path.
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
    const char *dsn = getenv("QUAERO_SSH_DSN");
    if (dsn == NULL || dsn[0] == '\0') {
        printf("SKIP: QUAERO_SSH_DSN not set; SSH tunnel integration test skipped\n");
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
    EXPECT(drv != NULL && strcmp(drv->name, "mysql") == 0, "driver is mysql");

    dbcore_runtime_reset();
    dbcore_runtime_register_driver(dbcore_runtime_get(), drv);

    /* Progress markers (flushed) so a hang shows its last reached phase in the
       CI log when the test times out. */
#define STEP(msg) do { fprintf(stderr, "STEP: %s\n", (msg)); fflush(stderr); } while (0)

    /* conn.open: the dsn carries ssh_* fields, so the core stands up the tunnel
       and the driver connects to 127.0.0.1:<local_port> behind it. */
    STEP("opening connection through tunnel");
    char conn_id[32] = {0};
    {
        char req[2048];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                 "\"params\":{\"driver\":\"mysql\",\"dsn\":%s}}",
                 dsn);
        cJSON *root = call(req);
        cJSON *cid = cJSON_GetObjectItem(result_of(root), "connId");
        EXPECT(cJSON_IsString(cid), "conn.open over the tunnel returns a connId");
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
        fprintf(stderr, "FAIL: no connId; aborting\n");
        dbcore_runtime_reset();
        dbc_plugin_unload(plugin);
        return 1;
    }

    STEP("connection open; running query through tunnel");

    /* A real round-trip THROUGH the forward: SELECT 1 must come back as "1". */
    {
        char req[512];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"query.run\","
                 "\"params\":{\"connId\":\"%s\",\"sql\":\"SELECT 1\"}}",
                 conn_id);
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(res != NULL, "query.run over the tunnel succeeds");
        cJSON *rows = cJSON_GetObjectItem(res, "rows");
        EXPECT(cJSON_GetArraySize(rows) == 1, "one row back");
        cJSON *cell = cJSON_GetArrayItem(cJSON_GetArrayItem(rows, 0), 0);
        EXPECT(cJSON_IsString(cell) && strcmp(cell->valuestring, "1") == 0,
               "SELECT 1 returns 1 through the tunnel");
        cJSON_Delete(root);
    }

    STEP("query done; closing connection (tears down tunnel)");

    /* conn.close tears the driver connection down and then the tunnel. */
    {
        char req[256];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"conn.close\","
                 "\"params\":{\"connId\":\"%s\"}}",
                 conn_id);
        cJSON *root = call(req);
        EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(result_of(root), "closed")),
               "conn.close over the tunnel");
        cJSON_Delete(root);
    }

    dbcore_runtime_reset();
    dbc_plugin_unload(plugin);

    if (failures == 0) {
        printf("OK: SSH tunnel integration (conn + query through the forward)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
