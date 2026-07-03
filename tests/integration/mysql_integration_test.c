/*
 * MySQL/MariaDB integration test: the whole core data path against a real
 * server, driven through the public JSON-RPC dispatcher (conn.open -> query.run
 * -> schema.* -> conn.close).
 *
 * Requires a reachable server. The connection DSN (a JSON object) is read from
 * the QUAERO_MYSQL_DSN environment variable; when it is unset the test SKIPS
 * (exit 0) so local/dev runs without a server stay green. CI sets it to point
 * at the MariaDB service container.
 *
 * MYSQL_PLUGIN_PATH is injected by CMake as the built plugin's full path.
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

/* result object of a call, or NULL (the caller still owns `root`). */
static cJSON *result_of(cJSON *root)
{
    return cJSON_GetObjectItem(root, "result");
}

int main(void)
{
    const char *dsn = getenv("QUAERO_MYSQL_DSN");
    if (dsn == NULL || dsn[0] == '\0') {
        printf("SKIP: QUAERO_MYSQL_DSN not set; MySQL integration test skipped\n");
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

    /* conn.open with the env DSN inlined as the dsn object. */
    char conn_id[32] = {0};
    {
        char req[1024];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                 "\"params\":{\"driver\":\"mysql\",\"dsn\":%s}}",
                 dsn);
        cJSON *root = call(req);
        cJSON *cid = cJSON_GetObjectItem(result_of(root), "connId");
        EXPECT(cJSON_IsString(cid), "conn.open returns a connId");
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

    char req[1024];
    const char *stmts[] = {
        "DROP TABLE IF EXISTS quaero_it",
        "CREATE TABLE quaero_it (id INT PRIMARY KEY, name VARCHAR(32) NOT NULL)",
        "INSERT INTO quaero_it VALUES (1,'alice'),(2,'bob')",
    };
    for (size_t i = 0; i < sizeof stmts / sizeof stmts[0]; i++) {
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"query.run\","
                 "\"params\":{\"connId\":\"%s\",\"sql\":\"%s\"}}",
                 conn_id, stmts[i]);
        cJSON *root = call(req);
        EXPECT(result_of(root) != NULL, "setup statement ok");
        cJSON_Delete(root);
    }

    /* SELECT: two rows, two columns. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"SELECT id, name FROM quaero_it ORDER BY id\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "columns")) == 2, "two columns");
        EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 2, "two rows");
        cJSON *c00 = cJSON_GetArrayItem(cJSON_GetArrayItem(cJSON_GetObjectItem(res, "rows"), 0), 1);
        EXPECT(cJSON_IsString(c00) && strcmp(c00->valuestring, "alice") == 0, "row0 name alice");
        cJSON_Delete(root);
    }

    /* Row editing (#26/#27): insert, update and delete a row over IPC, keyed on
       the primary key. The table currently holds ids 1 and 2. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":30,\"method\":\"row.insert\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"quaero_it\","
             "\"values\":{\"id\":\"3\",\"name\":\"carol\"}}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *ra = cJSON_GetObjectItem(result_of(root), "rowsAffected");
        EXPECT(cJSON_IsNumber(ra) && ra->valueint == 1, "row.insert affects one row");
        cJSON_Delete(root);
    }
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":31,\"method\":\"row.update\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"quaero_it\","
             "\"set\":{\"name\":\"caroline\"},\"where\":{\"id\":\"3\"}}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        cJSON *sql = cJSON_GetObjectItem(res, "sql");
        cJSON *ra = cJSON_GetObjectItem(res, "rowsAffected");
        EXPECT(cJSON_IsString(sql) && strstr(sql->valuestring, "UPDATE") != NULL,
               "row.update returns the sql");
        EXPECT(cJSON_IsNumber(ra) && ra->valueint == 1, "row.update affects one row");
        cJSON_Delete(root);
    }
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":32,\"method\":\"row.delete\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"quaero_it\","
             "\"where\":{\"id\":\"3\"}}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *ra = cJSON_GetObjectItem(result_of(root), "rowsAffected");
        EXPECT(cJSON_IsNumber(ra) && ra->valueint == 1, "row.delete affects one row");
        cJSON_Delete(root);
    }

    /* schema.describe: one row per column (id, name). */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"schema.describe\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"quaero_it\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(res != NULL && cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 2,
               "describe: two columns described");
        cJSON_Delete(root);
    }

    /* schema.describe with an explicit db (cross-database path, ABI 3): the
       table is named via its containing database rather than the default. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"schema.describe\","
             "\"params\":{\"connId\":\"%s\",\"db\":\"quaero_test\",\"table\":\"quaero_it\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(res != NULL && cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 2,
               "describe with db: two columns described");
        cJSON_Delete(root);
    }

    /* schema.ddl: a CREATE statement in a single "sql" column. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"schema.ddl\","
             "\"params\":{\"connId\":\"%s\",\"object\":\"quaero_it\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *rows = cJSON_GetObjectItem(result_of(root), "rows");
        EXPECT(cJSON_GetArraySize(rows) == 1, "ddl one row");
        cJSON *cell = cJSON_GetArrayItem(cJSON_GetArrayItem(rows, 0), 0);
        EXPECT(cJSON_IsString(cell) && strstr(cell->valuestring, "CREATE TABLE") != NULL,
               "ddl is a CREATE TABLE");
        cJSON_Delete(root);
    }

    /* schema.tree at the root: at least one database. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"schema.tree\","
             "\"params\":{\"connId\":\"%s\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(res != NULL && cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) >= 1,
               "schema.tree lists databases");
        cJSON_Delete(root);
    }

    /* Clean up the test table. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"DROP TABLE quaero_it\"}}",
             conn_id);
    { cJSON *root = call(req); cJSON_Delete(root); }

    /* conn.close. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"conn.close\","
             "\"params\":{\"connId\":\"%s\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(result_of(root), "closed")), "conn.close");
        cJSON_Delete(root);
    }

    dbcore_runtime_reset();
    dbc_plugin_unload(plugin);

    if (failures == 0) {
        printf("OK: MySQL integration (conn + query + schema over IPC)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
