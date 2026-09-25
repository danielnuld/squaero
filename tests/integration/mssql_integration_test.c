/*
 * SQL Server integration test: the core data path against a real server,
 * through the public JSON-RPC dispatcher (conn.open -> query.run -> schema.tree
 * -> conn.close), with the types the grid shows.
 *
 * SKIPS (exit 0) unless QUAERO_MSSQL_DSN holds a connection DSN (a JSON
 * object). MSSQL_PLUGIN_PATH is injected by CMake as the built plugin's path.
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

static char conn_id[32];

/* query.run of sql; the response, owned by the caller. */
static cJSON *run(const char *sql)
{
    cJSON *req = cJSON_CreateObject(), *params = cJSON_CreateObject();
    cJSON_AddStringToObject(req, "jsonrpc", "2.0");
    cJSON_AddNumberToObject(req, "id", 1);
    cJSON_AddStringToObject(req, "method", "query.run");
    cJSON_AddStringToObject(params, "connId", conn_id);
    cJSON_AddStringToObject(params, "sql", sql);
    cJSON_AddItemToObject(req, "params", params);
    char *text = cJSON_PrintUnformatted(req);
    char *resp = dbcore_ipc_handle(text);
    cJSON *root = cJSON_Parse(resp);
    dbcore_ipc_free(resp);
    cJSON_free(text);
    cJSON_Delete(req);
    return root;
}

static void run_ok(const char *sql)
{
    cJSON *root = run(sql);
    if (cJSON_GetObjectItem(root, "result") == NULL) {
        char *t = cJSON_PrintUnformatted(root);
        fprintf(stderr, "FAIL: %s -> %s\n", sql, t ? t : "?");
        cJSON_free(t);
        failures++;
    }
    cJSON_Delete(root);
}

static const char *cell(cJSON *res, int row, int col)
{
    cJSON *c = cJSON_GetArrayItem(cJSON_GetArrayItem(cJSON_GetObjectItem(res, "rows"), row), col);
    return cJSON_IsString(c) ? c->valuestring : NULL;
}

int main(void)
{
    const char *dsn = getenv("QUAERO_MSSQL_DSN");
    if (dsn == NULL || dsn[0] == '\0') {
        printf("SKIP: QUAERO_MSSQL_DSN not set; SQL Server integration test skipped\n");
        return 0;
    }
    char err[256];
    dbc_plugin *plugin = NULL;
    if (dbc_plugin_load(MSSQL_PLUGIN_PATH, &plugin, err, sizeof err) != DBC_OK) {
        fprintf(stderr, "could not load %s: %s\n", MSSQL_PLUGIN_PATH, err);
        return 1;
    }
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    EXPECT(drv != NULL && strcmp(drv->name, "mssql") == 0, "driver is mssql");
    dbcore_runtime_reset();
    dbcore_runtime_register_driver(dbcore_runtime_get(), drv);

    {
        char req[1024];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                 "\"params\":{\"driver\":\"mssql\",\"dsn\":%s}}",
                 dsn);
        char *resp = dbcore_ipc_handle(req);
        cJSON *root = cJSON_Parse(resp);
        dbcore_ipc_free(resp);
        cJSON *cid = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "connId");
        if (cJSON_IsString(cid)) {
            snprintf(conn_id, sizeof conn_id, "%s", cid->valuestring);
        } else {
            char *t = cJSON_PrintUnformatted(root);
            fprintf(stderr, "conn.open: %s\n", t ? t : "?");
            cJSON_free(t);
        }
        cJSON_Delete(root);
    }
    if (conn_id[0] == '\0') {
        fprintf(stderr, "FAIL: no connId; aborting\n");
        return 1;
    }

    run_ok("DROP TABLE IF EXISTS quaero_it");
    run_ok("CREATE TABLE quaero_it (id int PRIMARY KEY, name nvarchar(32) NOT NULL, "
           "price decimal(10,2), at datetime2(3), ok bit, g uniqueidentifier, bin varbinary(4))");
    {
        cJSON *root = run("INSERT INTO quaero_it VALUES (1, N'Peña', 12.50, '2024-03-05 13:04:05.123', "
                          "1, '6F9619FF-8B86-D011-B42D-00C04FC964FF', 0x00FF), "
                          "(2, N'bob', NULL, NULL, 0, NULL, NULL)");
        cJSON *ra = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "rowsAffected");
        EXPECT(cJSON_IsNumber(ra) && ra->valueint == 2, "insert affects two rows");
        cJSON_Delete(root);
    }
    {
        cJSON *root = run("SELECT id, name, price, at, ok, g, bin FROM quaero_it ORDER BY id");
        cJSON *res = cJSON_GetObjectItem(root, "result");
        EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "columns")) == 7, "seven columns");
        EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 2, "two rows");
        static const char *const want[] = {"1", "Peña", "12.50", "2024-03-05 13:04:05.123", "1",
                                           "6F9619FF-8B86-D011-B42D-00C04FC964FF", "0x00FF"};
        for (int i = 0; i < 7; i++) {
            const char *got = cell(res, 0, i);
            if (got == NULL || strcmp(got, want[i]) != 0) {
                fprintf(stderr, "FAIL: column %d: got [%s], want [%s]\n", i, got ? got : "NULL",
                        want[i]);
                failures++;
            }
        }
        EXPECT(cell(res, 1, 2) == NULL, "NULL price stays NULL");
        cJSON_Delete(root);
    }
    {
        cJSON *root = run("UPDATE quaero_it SET name = N'Bob' WHERE id = 2");
        cJSON *ra = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "rowsAffected");
        EXPECT(cJSON_IsNumber(ra) && ra->valueint == 1, "update affects one row");
        cJSON_Delete(root);
    }
    {
        /* A server error comes back as an error, with the server's text. */
        cJSON *root = run("SELECT * FROM quaero_missing");
        cJSON *e = cJSON_GetObjectItem(root, "error");
        cJSON *m = cJSON_GetObjectItem(e, "message");
        EXPECT(e != NULL && cJSON_IsString(m) && strstr(m->valuestring, "quaero_missing"),
               "a missing table is an error naming it");
        cJSON_Delete(root);
    }
    {
        cJSON *root = run("SELECT COUNT(*) FROM quaero_it");
        EXPECT(cell(cJSON_GetObjectItem(root, "result"), 0, 0) &&
                   strcmp(cell(cJSON_GetObjectItem(root, "result"), 0, 0), "2") == 0,
               "the connection works after an error");
        cJSON_Delete(root);
    }
    {
        char req[256];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"schema.tree\","
                 "\"params\":{\"connId\":\"%s\"}}",
                 conn_id);
        char *resp = dbcore_ipc_handle(req);
        cJSON *root = cJSON_Parse(resp);
        dbcore_ipc_free(resp);
        cJSON *res = cJSON_GetObjectItem(root, "result");
        EXPECT(res != NULL && cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) >= 1,
               "schema.tree lists databases");
        cJSON_Delete(root);
    }
    run_ok("DROP TABLE quaero_it");

    dbcore_runtime_reset();
    dbc_plugin_unload(plugin);
    if (failures == 0) {
        printf("OK: SQL Server integration (conn + query + types + schema over IPC)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
