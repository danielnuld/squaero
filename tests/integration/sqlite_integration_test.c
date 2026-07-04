/*
 * M1 capstone integration test: exercise the whole core data path against the
 * real SQLite driver — no stubs.
 *
 *   Part A: load the plugin via the dynamic loader, open a connection through
 *           the connection manager, and run DDL/DML/SELECT via dbcore_query_run.
 *   Part B: the same engine driven through the public JSON-RPC dispatcher
 *           (conn.open -> query.run -> conn.close), proving the IPC + result
 *           serialization layers work end-to-end with a real driver.
 *
 * SQLITE_PLUGIN_PATH is injected by CMake as the built plugin's full path.
 */
#include "dbcore/conn.h"
#include "dbcore/ipc.h"
#include "dbcore/loader.h"
#include "dbcore/query.h"
#include "dbcore/result.h"
#include "dbcore/runtime.h"

#include "cJSON.h"

#include <stdio.h>
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

/* --- Part A: loader + connection manager + query, core C API --- */
static void test_core_api(const dbc_driver_t *drv)
{
    char err[256];
    dbcore_conn_manager *mgr = dbcore_conn_manager_new();
    EXPECT(mgr != NULL, "manager allocates");

    int id = 0;
    EXPECT(dbcore_conn_manager_open(mgr, drv, "{\"path\":\":memory:\"}", &id,
                                    err, sizeof err) == DBC_OK, "open :memory:");
    if (id == 0) {  /* open failed; downstream steps would cascade misleadingly */
        dbcore_conn_manager_free(mgr);
        return;
    }

    dbcore_conn_ref ref;
    EXPECT(dbcore_conn_manager_get(mgr, id, &ref) == 1, "borrow connection");

    dbcore_result *r = NULL;
    EXPECT(dbcore_query_run(&ref, "CREATE TABLE t (id INTEGER, name TEXT)", 0, 0,
                            &r, err, sizeof err) == DBC_OK, "DDL runs");
    EXPECT(dbcore_result_has_result_set(r) == 0, "DDL has no result set");
    dbcore_result_free(r);
    r = NULL;

    EXPECT(dbcore_query_run(&ref, "INSERT INTO t VALUES (1,'alice'),(2,NULL)", 0, 0,
                            &r, err, sizeof err) == DBC_OK, "DML runs");
    EXPECT(dbcore_result_rows_affected(r) == 2, "two rows affected");
    dbcore_result_free(r);
    r = NULL;

    EXPECT(dbcore_query_run(&ref, "SELECT id, name FROM t ORDER BY id", 0, 0,
                            &r, err, sizeof err) == DBC_OK, "SELECT runs");
    EXPECT(dbcore_result_col_count(r) == 2, "two columns");
    EXPECT(dbcore_result_col_type(r, 0) == DBC_TYPE_INT, "id is INT");
    EXPECT(dbcore_result_col_type(r, 1) == DBC_TYPE_TEXT, "name is TEXT");
    EXPECT(dbcore_result_row_count(r) == 2, "two rows");
    EXPECT(strcmp(dbcore_result_cell(r, 0, 1), "alice") == 0, "row0 name");
    EXPECT(dbcore_result_cell_is_null(r, 1, 1) == 1, "row1 name is SQL NULL");
    dbcore_result_free(r);
    r = NULL;

    /* A bad query surfaces the driver's error. */
    EXPECT(dbcore_query_run(&ref, "SELECT * FROM missing", 0, 0, &r, err,
                            sizeof err) == DBC_ERR_QUERY, "bad query fails");
    EXPECT(r == NULL, "no result on failure");
    EXPECT(strstr(err, "no such table") != NULL, "driver error propagated");

    EXPECT(dbcore_conn_manager_close(mgr, id) == DBC_OK, "close");
    dbcore_conn_manager_free(mgr);
}

/* --- Part B: the same engine through the JSON-RPC dispatcher --- */
static void test_ipc_path(const dbc_driver_t *drv)
{
    dbcore_runtime_reset();
    dbcore_runtime_register_driver(dbcore_runtime_get(), drv);

    /* conn.open */
    char conn_id[32] = {0};
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                           "\"params\":{\"driver\":\"sqlite\",\"dsn\":{\"path\":\":memory:\"}}}");
        cJSON *cid = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "connId");
        EXPECT(cJSON_IsString(cid), "conn.open returns a connId");
        if (cJSON_IsString(cid)) {
            snprintf(conn_id, sizeof conn_id, "%s", cid->valuestring);
        }
        cJSON_Delete(root);
    }
    if (conn_id[0] == '\0') {  /* no connId -> the rest of Part B is meaningless */
        fprintf(stderr, "FAIL: conn.open returned no connId; skipping rest of IPC path\n");
        failures++;
        dbcore_runtime_reset();
        return;
    }

    char req[256];

    /* DDL + DML via query.run. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"CREATE TABLE t (n INTEGER)\"}}",
             conn_id);
    { cJSON *root = call(req);
      EXPECT(cJSON_GetObjectItem(root, "result") != NULL, "DDL over IPC ok");
      cJSON_Delete(root); }

    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"INSERT INTO t VALUES (10),(20),(30)\"}}",
             conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      cJSON *ra = cJSON_GetObjectItem(res, "rowsAffected");
      EXPECT(cJSON_IsNumber(ra) && ra->valueint == 3, "3 rows affected over IPC");
      cJSON_Delete(root); }

    /* SELECT with a limit -> paginated, truncated result. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"SELECT n FROM t ORDER BY n\",\"limit\":2}}",
             conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "columns")) == 1, "one column over IPC");
      EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 2, "limited to 2 rows");
      EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(res, "truncated")), "truncation reported");
      cJSON *first = cJSON_GetArrayItem(cJSON_GetArrayItem(cJSON_GetObjectItem(res, "rows"), 0), 0);
      EXPECT(cJSON_IsString(first) && strcmp(first->valuestring, "10") == 0, "first cell value");
      cJSON_Delete(root); }

    /* Transactions (#28): a rolled-back insert leaves the table unchanged; a
       committed one persists. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tx.begin\","
             "\"params\":{\"connId\":\"%s\"}}", conn_id);
    { cJSON *root = call(req);
      EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "ok")),
             "tx.begin over IPC ok");
      cJSON_Delete(root); }

    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"INSERT INTO t VALUES (40)\"}}", conn_id);
    { cJSON *root = call(req); cJSON_Delete(root); }

    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":13,\"method\":\"tx.rollback\","
             "\"params\":{\"connId\":\"%s\"}}", conn_id);
    { cJSON *root = call(req);
      EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "ok")),
             "tx.rollback over IPC ok");
      cJSON_Delete(root); }

    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":14,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"SELECT COUNT(*) FROM t\"}}", conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      cJSON *cell = cJSON_GetArrayItem(cJSON_GetArrayItem(cJSON_GetObjectItem(res, "rows"), 0), 0);
      EXPECT(cJSON_IsString(cell) && strcmp(cell->valuestring, "3") == 0,
             "rollback discarded the insert (still 3 rows)");
      cJSON_Delete(root); }

    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":15,\"method\":\"tx.begin\","
             "\"params\":{\"connId\":\"%s\"}}", conn_id);
    { cJSON *root = call(req); cJSON_Delete(root); }
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":16,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"INSERT INTO t VALUES (40)\"}}", conn_id);
    { cJSON *root = call(req); cJSON_Delete(root); }
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":17,\"method\":\"tx.commit\","
             "\"params\":{\"connId\":\"%s\"}}", conn_id);
    { cJSON *root = call(req);
      EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "ok")),
             "tx.commit over IPC ok");
      cJSON_Delete(root); }
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":18,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"SELECT COUNT(*) FROM t\"}}", conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      cJSON *cell = cJSON_GetArrayItem(cJSON_GetArrayItem(cJSON_GetObjectItem(res, "rows"), 0), 0);
      EXPECT(cJSON_IsString(cell) && strcmp(cell->valuestring, "4") == 0,
             "commit persisted the insert (now 4 rows)");
      cJSON_Delete(root); }

    /* Clean up the extra row so the later describe/ddl assertions are unaffected. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":19,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"DELETE FROM t WHERE n = 40\"}}", conn_id);
    { cJSON *root = call(req); cJSON_Delete(root); }

    /* Row editing (#26/#27/#29): preview generates SQL without executing; apply
       runs it. The table 't' has 3 rows (10,20,30) at this point. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"row.insert\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"t\",\"values\":{\"n\":\"99\"},\"preview\":true}}",
             conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      cJSON *sql = cJSON_GetObjectItem(res, "sql");
      EXPECT(cJSON_IsString(sql) && strstr(sql->valuestring, "INSERT INTO") != NULL,
             "preview returns the INSERT sql");
      EXPECT(cJSON_GetObjectItem(res, "rowsAffected") == NULL,
             "preview does not report rowsAffected");
      cJSON_Delete(root); }

    /* The preview must not have changed anything: still 3 rows. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":21,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"SELECT COUNT(*) FROM t\"}}", conn_id);
    { cJSON *root = call(req);
      cJSON *cell = cJSON_GetArrayItem(cJSON_GetArrayItem(
          cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "rows"), 0), 0);
      EXPECT(cJSON_IsString(cell) && strcmp(cell->valuestring, "3") == 0,
             "preview did not insert");
      cJSON_Delete(root); }

    /* Apply the insert. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":22,\"method\":\"row.insert\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"t\",\"values\":{\"n\":\"99\"}}}", conn_id);
    { cJSON *root = call(req);
      cJSON *ra = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "rowsAffected");
      EXPECT(cJSON_IsNumber(ra) && ra->valueint == 1, "insert affects one row");
      cJSON_Delete(root); }

    /* Update it, keyed on its value. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":23,\"method\":\"row.update\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"t\","
             "\"set\":{\"n\":\"100\"},\"where\":{\"n\":\"99\"}}}", conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      cJSON *sql = cJSON_GetObjectItem(res, "sql");
      cJSON *ra = cJSON_GetObjectItem(res, "rowsAffected");
      EXPECT(cJSON_IsString(sql) && strstr(sql->valuestring, "UPDATE") != NULL, "update sql");
      EXPECT(cJSON_IsNumber(ra) && ra->valueint == 1, "update affects one row");
      cJSON_Delete(root); }

    /* Delete it, restoring the table to 3 rows. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":24,\"method\":\"row.delete\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"t\",\"where\":{\"n\":\"100\"}}}", conn_id);
    { cJSON *root = call(req);
      cJSON *ra = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "rowsAffected");
      EXPECT(cJSON_IsNumber(ra) && ra->valueint == 1, "delete affects one row");
      cJSON_Delete(root); }

    /* schema.tree at the root (no params) -> the database list ('main'). */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"schema.tree\","
             "\"params\":{\"connId\":\"%s\"}}", conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      EXPECT(res != NULL, "schema.tree (root) over IPC ok");
      cJSON *rows = cJSON_GetObjectItem(res, "rows");
      int saw_main = 0;
      for (int i = 0; i < cJSON_GetArraySize(rows); i++) {
          cJSON *name = cJSON_GetArrayItem(cJSON_GetArrayItem(rows, i), 0);
          if (cJSON_IsString(name) && strcmp(name->valuestring, "main") == 0) saw_main = 1;
      }
      EXPECT(saw_main, "'main' database listed at the root");
      cJSON_Delete(root); }

    /* schema.tree under db 'main' -> tables (SQLite has no schemas), with the
       table 't' we created (columns name, type). */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"schema.tree\","
             "\"params\":{\"connId\":\"%s\",\"db\":\"main\"}}", conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "columns")) == 2,
             "tree tables: name + type columns");
      cJSON *rows = cJSON_GetObjectItem(res, "rows");
      int saw_t = 0;
      for (int i = 0; i < cJSON_GetArraySize(rows); i++) {
          cJSON *name = cJSON_GetArrayItem(cJSON_GetArrayItem(rows, i), 0);
          if (cJSON_IsString(name) && strcmp(name->valuestring, "t") == 0) saw_t = 1;
      }
      EXPECT(saw_t, "table 't' appears under db 'main'");
      cJSON_Delete(root); }

    /* schema.describe -> one row per column of 't' (it has a single column n). */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"schema.describe\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"t\"}}", conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      EXPECT(res != NULL, "schema.describe over IPC ok");
      EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 1, "table t has one column");
      cJSON_Delete(root); }

    /* schema.ddl -> the CREATE statement of 't'. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"schema.ddl\","
             "\"params\":{\"connId\":\"%s\",\"object\":\"t\"}}", conn_id);
    { cJSON *root = call(req);
      cJSON *res = cJSON_GetObjectItem(root, "result");
      cJSON *rows = cJSON_GetObjectItem(res, "rows");
      EXPECT(cJSON_GetArraySize(rows) == 1, "schema.ddl returns one row");
      cJSON *sql_cell = cJSON_GetArrayItem(cJSON_GetArrayItem(rows, 0), 0);
      EXPECT(cJSON_IsString(sql_cell) && strstr(sql_cell->valuestring, "CREATE TABLE") != NULL,
             "ddl is a CREATE statement");
      cJSON_Delete(root); }

    /* conn.close */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"conn.close\","
             "\"params\":{\"connId\":\"%s\"}}", conn_id);
    { cJSON *root = call(req);
      EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "closed")),
             "conn.close over IPC");
      cJSON_Delete(root); }

    dbcore_runtime_reset();
}

int main(void)
{
    char err[256] = {0};
    dbc_plugin *plugin = NULL;
    dbc_status st = dbc_plugin_load(SQLITE_PLUGIN_PATH, &plugin, err, sizeof err);
    EXPECT(st == DBC_OK, "load the real SQLite plugin");
    if (st != DBC_OK) {
        fprintf(stderr, "could not load %s: %s\n", SQLITE_PLUGIN_PATH, err);
        return 1;
    }

    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    EXPECT(drv != NULL && strcmp(drv->name, "sqlite") == 0, "loaded driver is sqlite");

    test_core_api(drv);
    test_ipc_path(drv);

    dbc_plugin_unload(plugin);

    if (failures == 0) {
        printf("OK: SQLite integration (loader + manager + query + IPC)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
