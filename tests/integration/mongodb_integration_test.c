/*
 * MongoDB integration test: the core data path against a real server, driven
 * through the public JSON-RPC dispatcher (conn.open -> query.run -> schema.* ->
 * conn.close). Exercises the mongosh-style query surface (find/aggregate with
 * relaxed, unquoted keys) and the document->row flattening (union columns,
 * SQL NULL for a missing field, a nested document rendered as a JSON cell).
 *
 * It also covers the write and utility commands (insert/update/replace/delete,
 * countDocuments, distinct, indexes, createCollection, drop, runCommand) with
 * their real rows_affected, document editing from the grid (row.insert /
 * row.update / row.delete -> build_dml -> the same commands), and that an unknown
 * method is reported as UNSUPPORTED rather than faked. Those use a scratch
 * collection (quaero_w) that the test creates and drops itself.
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

/* ---- helpers for the write / DML / DDL section ------------------------- */

static int g_rpc_id = 100;

/* Call `method` with `params` (ownership taken); returns the parsed response. */
static cJSON *rpc(const char *method, cJSON *params)
{
    cJSON *req = cJSON_CreateObject();
    cJSON_AddStringToObject(req, "jsonrpc", "2.0");
    cJSON_AddNumberToObject(req, "id", g_rpc_id++);
    cJSON_AddStringToObject(req, "method", method);
    cJSON_AddItemToObject(req, "params", params);
    char *text = cJSON_PrintUnformatted(req);
    cJSON_Delete(req);
    cJSON *root = call(text);
    free(text);
    return root;
}

static cJSON *params_for(const char *conn_id)
{
    cJSON *p = cJSON_CreateObject();
    cJSON_AddStringToObject(p, "connId", conn_id);
    return p;
}

/* Run a mongosh command; the caller deletes the response. */
static cJSON *run(const char *conn_id, const char *sql)
{
    cJSON *p = params_for(conn_id);
    cJSON_AddStringToObject(p, "sql", sql);
    return rpc("query.run", p);
}

static int is_error(cJSON *root)
{
    return cJSON_GetObjectItem(root, "error") != NULL;
}

static const char *error_text(cJSON *root)
{
    cJSON *e = cJSON_GetObjectItem(root, "error");
    cJSON *m = e ? cJSON_GetObjectItem(e, "message") : NULL;
    return cJSON_IsString(m) ? m->valuestring : "(no error)";
}

/* The text of cell (0, column `name`) of a result, or "". */
static const char *first_cell(cJSON *root, const char *name)
{
    cJSON *res = result_of(root);
    int i = res ? col_index(res, name) : -1;
    cJSON *c = i >= 0 ? cell(res, 0, i) : NULL;
    return cJSON_IsString(c) ? c->valuestring : "";
}

/* rowsAffected of a query.run / row.* response, or -1. */
static double rows_affected(cJSON *root)
{
    cJSON *res = result_of(root);
    cJSON *n = res ? cJSON_GetObjectItem(res, "rowsAffected") : NULL;
    return cJSON_IsNumber(n) ? n->valuedouble : -1;
}

static int row_count(cJSON *root)
{
    cJSON *res = result_of(root);
    return res ? cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) : -1;
}

/* Run `sql`, require success and the given rowsAffected, and (when col != NULL)
   the first-row text of `col`. */
static void expect_cmd(const char *conn_id, const char *sql, double affected,
                       const char *col, const char *want)
{
    cJSON *root = run(conn_id, sql);
    char msg[400];
    snprintf(msg, sizeof msg, "%s succeeds (%s)", sql, is_error(root) ? error_text(root) : "ok");
    EXPECT(!is_error(root), msg);
    if (!is_error(root)) {
        snprintf(msg, sizeof msg, "%s rowsAffected == %g (got %g)", sql, affected,
                 rows_affected(root));
        EXPECT(rows_affected(root) == affected, msg);
        if (col != NULL) {
            snprintf(msg, sizeof msg, "%s: %s is '%s' (got '%s')", sql, col, want,
                     first_cell(root, col));
            EXPECT(strcmp(first_cell(root, col), want) == 0, msg);
        }
    }
    cJSON_Delete(root);
}

/* Run `sql` and require an error whose message contains `frag` (and, when
   code != 0, that JSON-RPC error code). */
static void expect_cmd_error(const char *conn_id, const char *sql, int code, const char *frag)
{
    cJSON *root = run(conn_id, sql);
    char msg[400];
    snprintf(msg, sizeof msg, "%s fails", sql);
    EXPECT(is_error(root), msg);
    if (is_error(root)) {
        snprintf(msg, sizeof msg, "%s error mentions '%s' (got '%s')", sql, frag, error_text(root));
        EXPECT(strstr(error_text(root), frag) != NULL, msg);
        if (code != 0) {
            cJSON *c = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "error"), "code");
            snprintf(msg, sizeof msg, "%s error code is %d", sql, code);
            EXPECT(cJSON_IsNumber(c) && (int)c->valuedouble == code, msg);
        }
    }
    cJSON_Delete(root);
}

/* A row.insert / row.update / row.delete call on quaero_w. `map` is the
   values / set object, `where` the key, `types` the setTypes; all owned. */
static cJSON *row_call(const char *method, const char *conn_id, int preview, cJSON *map,
                       cJSON *where, cJSON *types)
{
    cJSON *p = params_for(conn_id);
    cJSON_AddStringToObject(p, "table", "quaero_w");
    if (preview) {
        cJSON_AddTrueToObject(p, "preview");
    }
    if (map) {
        cJSON_AddItemToObject(p, strcmp(method, "row.insert") == 0 ? "values" : "set", map);
    }
    if (where) {
        cJSON_AddItemToObject(p, "where", where);
    }
    if (types) {
        cJSON_AddItemToObject(p, "setTypes", types);
    }
    return rpc(method, p);
}

static cJSON *obj1(const char *k, const char *v)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, k, v);
    return o;
}

/* Require a row.* response with the given rowsAffected. */
static void expect_row(cJSON *root, double affected, const char *what)
{
    EXPECT(!is_error(root) && rows_affected(root) == affected, what);
    if (is_error(root)) {
        fprintf(stderr, "  (%s: %s)\n", what, error_text(root));
    }
    cJSON_Delete(root);
}

/*
 * Write and utility commands and document editing (build_dml), against a scratch
 * collection.
 */
static void write_section(const char *conn_id)
{
    cJSON *root;
    char msg[400];

    /* Start clean (the collection may not exist: that error is ignored). */
    cJSON_Delete(run(conn_id, "db.quaero_w.drop()"));

    expect_cmd(conn_id, "db.createCollection(\"quaero_w\")", 0, "created", "quaero_w");

    /* --- inserts: real counts, an acknowledged result --------------------- */
    expect_cmd(conn_id, "db.quaero_w.insertOne({_id: 1, name: 'a', n: 10})", 1, "insertedId", "1");
    expect_cmd(conn_id,
               "db.quaero_w.insertMany([{_id: 2, name: 'b', n: 20}, {_id: 3, name: 'c', n: 30}])",
               2, "insertedCount", "2");
    expect_cmd_error(conn_id, "db.quaero_w.insertOne({_id: 1})", 0, "duplicate key");

    /* --- updates: rows_affected is the matched count, modifiedCount is shown --- */
    expect_cmd(conn_id, "db.quaero_w.updateOne({_id: 1}, {$set: {n: 11}})", 1, "modifiedCount", "1");
    expect_cmd(conn_id, "db.quaero_w.updateOne({_id: 1}, {$set: {n: 11}})", 1, "modifiedCount", "0");
    expect_cmd(conn_id, "db.quaero_w.updateMany({}, {$inc: {n: 1}})", 3, "modifiedCount", "3");
    expect_cmd(conn_id, "db.quaero_w.updateOne({_id: 99}, {$set: {n: 1}})", 0, "matchedCount", "0");
    expect_cmd(conn_id, "db.quaero_w.updateOne({_id: 99}, {$set: {n: 1}}, {upsert: true})", 1,
               "upsertedCount", "1");
    expect_cmd(conn_id, "db.quaero_w.updateOne({_id: 99}, [{$set: {n: 5}}])", 1, "modifiedCount", "1");
    expect_cmd(conn_id, "db.quaero_w.replaceOne({_id: 3}, {name: 'cc'})", 1, "matchedCount", "1");
    expect_cmd_error(conn_id, "db.quaero_w.updateOne({_id: 1}, {n: 5})", 0, "");

    /* --- reads ------------------------------------------------------------ */
    expect_cmd(conn_id, "db.quaero_w.countDocuments({})", 0, "count", "4");
    expect_cmd(conn_id, "db.quaero_w.countDocuments({name: 'a'})", 0, "count", "1");
    root = run(conn_id, "db.quaero_w.distinct('name')");
    snprintf(msg, sizeof msg, "distinct returns the 3 distinct names (got %d)", row_count(root));
    EXPECT(row_count(root) == 3, msg);
    cJSON_Delete(root);
    root = run(conn_id, "db.quaero_w.findOne({_id: 2})");
    EXPECT(row_count(root) == 1 && strcmp(first_cell(root, "name"), "b") == 0,
           "findOne returns the document");
    cJSON_Delete(root);
    root = run(conn_id, "db.quaero_w.findOne({_id: 12345})");
    EXPECT(!is_error(root) && row_count(root) == 0, "findOne with no match returns no rows");
    cJSON_Delete(root);

    /* --- indexes ---------------------------------------------------------- */
    expect_cmd(conn_id, "db.quaero_w.createIndex({name: 1}, {unique: true})", 0, "name", "name_1");
    expect_cmd(conn_id, "db.quaero_w.createIndex({n: -1, name: 1}, {name: 'by_n'})", 0, "name",
               "by_n");
    root = run(conn_id, "db.quaero_w.getIndexes()");
    EXPECT(row_count(root) == 3, "getIndexes lists _id_, name_1 and by_n");
    cJSON_Delete(root);

    expect_cmd(conn_id, "db.quaero_w.dropIndex('by_n')", 0, "nIndexesWas", "3");
    expect_cmd(conn_id, "db.quaero_w.dropIndex({name: 1})", 0, "nIndexesWas", "2");
    expect_cmd_error(conn_id, "db.quaero_w.dropIndex('nope')", 0, "");

    /* --- runCommand ------------------------------------------------------- */
    expect_cmd(conn_id, "db.runCommand({ping: 1})", 0, "ok", "1");
    expect_cmd(conn_id, "db.runCommand('ping')", 0, "ok", "1");
    expect_cmd(conn_id, "db.runCommand({delete: 'quaero_w', deletes: [{q: {_id: 99}, limit: 1}]})",
               1, "n", "1");
    expect_cmd_error(conn_id, "db.runCommand({noSuchCommandXyz: 1})", 0, "");

    /* --- document editing from the grid (build_dml, run through the commands) --- */
    {
        cJSON *vals = cJSON_CreateObject(), *types = cJSON_CreateObject();
        cJSON_AddStringToObject(vals, "_id", "10");
        cJSON_AddStringToObject(vals, "name", "grid");
        cJSON_AddStringToObject(vals, "n", "7");
        cJSON_AddStringToObject(types, "_id", "int");
        cJSON_AddStringToObject(types, "name", "text");
        cJSON_AddStringToObject(types, "n", "int");
        root = row_call("row.insert", conn_id, 1, cJSON_Duplicate(vals, 1), NULL,
                        cJSON_Duplicate(types, 1));
        cJSON *sql = cJSON_GetObjectItem(result_of(root), "sql");
        EXPECT(cJSON_IsString(sql) &&
                   strcmp(sql->valuestring,
                          "db.quaero_w.insertOne({\"_id\": 10, \"name\": \"grid\", \"n\": 7})") == 0,
               "row.insert preview renders insertOne");
        cJSON_Delete(root);
        expect_row(row_call("row.insert", conn_id, 0, vals, NULL, types), 1,
                   "row.insert inserts one document");
    }
    {
        cJSON *set = cJSON_CreateObject(), *types = cJSON_CreateObject();
        cJSON_AddStringToObject(set, "name", "edited");
        cJSON_AddStringToObject(set, "n", "8");
        cJSON_AddStringToObject(types, "name", "text");
        cJSON_AddStringToObject(types, "n", "int");
        expect_row(row_call("row.update", conn_id, 0, set, obj1("_id", "10"), types), 1,
                   "row.update by _id changes exactly one document");
        root = run(conn_id, "db.quaero_w.findOne({_id: 10})");
        EXPECT(strcmp(first_cell(root, "name"), "edited") == 0 &&
                   strcmp(first_cell(root, "n"), "8") == 0,
               "the edit is visible (and n stays a number)");
        cJSON_Delete(root);
    }

    /* A document with an ObjectId _id: the grid sends its hex text. */
    expect_cmd(conn_id, "db.quaero_w.insertOne({name: 'oid-doc'})", 1, NULL, NULL);
    {
        root = run(conn_id, "db.quaero_w.findOne({name: 'oid-doc'})");
        char hex[40] = "";
        snprintf(hex, sizeof hex, "%s", first_cell(root, "_id"));
        EXPECT(strlen(hex) == 24, "the generated _id is an ObjectId (24 hex digits)");
        cJSON_Delete(root);

        expect_row(row_call("row.update", conn_id, 0, obj1("name", "oid-edited"), obj1("_id", hex),
                            obj1("name", "text")),
                   1, "row.update finds an ObjectId _id from its hex text");
        expect_row(row_call("row.delete", conn_id, 0, NULL, obj1("_id", hex), NULL), 1,
                   "row.delete removes the ObjectId document");
    }
    expect_row(row_call("row.delete", conn_id, 0, NULL, obj1("_id", "10"), NULL), 1,
               "row.delete removes the edited document");
    expect_row(row_call("row.delete", conn_id, 0, NULL, obj1("_id", "10"), NULL), 0,
               "row.delete of a missing document affects 0 (the UI flags it)");

    /* --- deletes ------------------------------------------------------------ */
    expect_cmd(conn_id, "db.quaero_w.deleteOne({_id: 3})", 1, "deletedCount", "1");
    expect_cmd(conn_id, "db.quaero_w.deleteMany({})", 2, "deletedCount", "2");

    /* --- unsupported / malformed are explicit errors, never a fake success ---- */
    expect_cmd_error(conn_id, "db.quaero_w.bulkWrite([])", -32001,
                     "unsupported operation 'bulkWrite'");
    expect_cmd_error(conn_id, "db.quaero_w.deleteMany()", 0, "at least 1");
    expect_cmd_error(conn_id, "db.quaero_w.insertOne({a: })", 0, "invalid document");
    expect_cmd_error(conn_id, "db.runCommand({ping: 1}, {readPreference: 'primary'})", -32001,
                     "not supported");

    expect_cmd(conn_id, "db.quaero_w.drop()", 0, "dropped", "quaero_w");
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

    write_section(conn_id);

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
        printf("OK: MongoDB integration (conn + query + writes + DML over IPC)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
