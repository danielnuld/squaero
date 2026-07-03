/*
 * MongoDB integration test: the core data path against a real server, driven
 * through the public JSON-RPC dispatcher (conn.open -> query.run -> schema.* ->
 * conn.close). Exercises the mongosh-style query surface (find/aggregate with
 * relaxed, unquoted keys) and the document->row flattening (union columns,
 * SQL NULL for a missing field, a nested document rendered as a JSON cell).
 *
 * Requires a reachable server, PRE-SEEDED with a `quaero_it` collection holding:
 *   { _id: 1, name: "alice" }
 *   { _id: 2, name: "bob", extra: { k: 1 } }
 * (CI seeds it before running.) The DSN is read from QUAERO_MONGODB_DSN; when it
 * is unset the test SKIPS (exit 0). MONGODB_PLUGIN_PATH is injected by CMake.
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

/* Index of the column named `name` in a result object, or -1. */
static int col_index(cJSON *res, const char *name)
{
    cJSON *cols = cJSON_GetObjectItem(res, "columns");
    int n = cJSON_GetArraySize(cols);
    for (int i = 0; i < n; i++) {
        cJSON *nm = cJSON_GetObjectItem(cJSON_GetArrayItem(cols, i), "name");
        if (cJSON_IsString(nm) && strcmp(nm->valuestring, name) == 0) {
            return i;
        }
    }
    return -1;
}

/* Cell (row, col) of a result, or NULL. */
static cJSON *cell(cJSON *res, int row, int col)
{
    cJSON *rows = cJSON_GetObjectItem(res, "rows");
    cJSON *r = cJSON_GetArrayItem(rows, row);
    return r != NULL ? cJSON_GetArrayItem(r, col) : NULL;
}

int main(void)
{
    const char *dsn = getenv("QUAERO_MONGODB_DSN");
    if (dsn == NULL || dsn[0] == '\0') {
        printf("SKIP: QUAERO_MONGODB_DSN not set; MongoDB integration test skipped\n");
        return 0;
    }

    char err[256];
    dbc_plugin *plugin = NULL;
    dbc_status st = dbc_plugin_load(MONGODB_PLUGIN_PATH, &plugin, err, sizeof err);
    EXPECT(st == DBC_OK, "load the MongoDB plugin");
    if (st != DBC_OK) {
        fprintf(stderr, "could not load %s: %s\n", MONGODB_PLUGIN_PATH, err);
        return 1;
    }
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    EXPECT(drv != NULL && strcmp(drv->name, "mongodb") == 0, "driver is mongodb");

    dbcore_runtime_reset();
    dbcore_runtime_register_driver(dbcore_runtime_get(), drv);

    char conn_id[32] = {0};
    {
        char req[1024];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                 "\"params\":{\"driver\":\"mongodb\",\"dsn\":%s}}",
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

    /* find() with a sort: two documents flattened into the union of their
       top-level fields (_id, name, extra). alice lacks `extra` -> SQL NULL;
       bob's `extra` is a nested document -> a JSON cell. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"db.quaero_it.find().sort({_id:1})\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(res != NULL, "find returns a result");
        if (res != NULL) {
            EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 2, "two rows");
            int i_id = col_index(res, "_id");
            int i_name = col_index(res, "name");
            int i_extra = col_index(res, "extra");
            EXPECT(i_id == 0, "_id is the first column");
            EXPECT(i_name >= 0 && i_extra >= 0, "name and extra columns present");

            cJSON *a_id = cell(res, 0, i_id);
            cJSON *a_name = cell(res, 0, i_name);
            cJSON *a_extra = cell(res, 0, i_extra);
            EXPECT(cJSON_IsString(a_id) && strcmp(a_id->valuestring, "1") == 0,
                   "row0 _id is 1");
            EXPECT(cJSON_IsString(a_name) && strcmp(a_name->valuestring, "alice") == 0,
                   "row0 name is alice");
            EXPECT(cJSON_IsNull(a_extra), "row0 extra is SQL NULL (missing field)");

            cJSON *b_extra = cell(res, 1, i_extra);
            EXPECT(cJSON_IsString(b_extra) && strstr(b_extra->valuestring, "k") != NULL,
                   "row1 extra is a JSON cell containing k");

            /* The extra column's neutral type is JSON. */
            cJSON *cols = cJSON_GetObjectItem(res, "columns");
            cJSON *extra_type = cJSON_GetObjectItem(cJSON_GetArrayItem(cols, i_extra), "type");
            EXPECT(cJSON_IsString(extra_type) && strcmp(extra_type->valuestring, "json") == 0,
                   "extra column type is json");
        }
        cJSON_Delete(root);
    }

    /* find() with an (unquoted) filter: exercises the relaxed-JSON normalizer. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"db.quaero_it.find({_id:1})\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(res != NULL && cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 1,
               "filtered find returns one row");
        if (res != NULL) {
            cJSON *nm = cell(res, 0, col_index(res, "name"));
            EXPECT(cJSON_IsString(nm) && strcmp(nm->valuestring, "alice") == 0,
                   "filtered row is alice");
        }
        cJSON_Delete(root);
    }

    /* aggregate() with a $match stage. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"db.quaero_it.aggregate([{$match:{_id:2}}])\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(res != NULL && cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 1,
               "aggregate $match returns one row");
        cJSON_Delete(root);
    }

    /* schema.tree at the root: at least one database. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"schema.tree\","
             "\"params\":{\"connId\":\"%s\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(res != NULL && cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) >= 1,
               "schema.tree lists databases");
        cJSON_Delete(root);
    }

    /* schema.describe: the inferred fields of the collection (>= _id, name). */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"schema.describe\","
             "\"params\":{\"connId\":\"%s\",\"table\":\"quaero_it\"}}",
             conn_id);
    {
        cJSON *root = call(req);
        cJSON *res = result_of(root);
        EXPECT(res != NULL && cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) >= 2,
               "describe reports the sampled fields");
        cJSON_Delete(root);
    }

    /* conn.close. */
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"conn.close\","
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
        printf("OK: MongoDB integration (conn + query + schema over IPC)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
