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
 * row.update / row.delete -> build_dml -> the same commands), the collection's
 * definition as a mongosh script (schema.ddl), and that an unknown method is
 * reported as UNSUPPORTED rather than faked. Those use a scratch collection
 * (quaero_w) that the test creates and drops itself.
 *
 * It then covers the explain plan, the operations monitor (currentOp / killOp),
 * the profiler, views and collection rename, and multi-document transactions: on
 * a standalone server begin must refuse explicitly (UNSUPPORTED, naming the
 * replica set); with QUAERO_MONGODB_RS_DSN pointing at a replica set the real
 * transaction behaviour (join, isolation, commit, rollback) is checked too.
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
 * Write and utility commands, document editing (build_dml) and the collection
 * definition (get_ddl), against a scratch collection.
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

    /* --- DDL: a reproducible mongosh script ---------------------------------- */
    {
        cJSON *p = params_for(conn_id);
        cJSON_AddStringToObject(p, "object", "quaero_w");
        root = rpc("schema.ddl", p);
        const char *ddl = first_cell(root, "sql");
        EXPECT(!is_error(root), "schema.ddl succeeds");
        EXPECT(strstr(ddl, "db.createCollection(\"quaero_w\");") != NULL,
               "ddl creates the collection");
        EXPECT(strstr(ddl, "db.quaero_w.createIndex({ \"n\" : -1, \"name\" : 1 }, "
                           "{ \"name\": \"by_n\" });") != NULL,
               "ddl recreates the compound index by name");
        EXPECT(strstr(ddl, "{ \"name\": \"name_1\", \"unique\" : true }") != NULL,
               "ddl keeps the unique option");
        EXPECT(strstr(ddl, "_id_") == NULL, "ddl leaves out the default _id_ index");
        cJSON_Delete(root);

        p = params_for(conn_id);
        cJSON_AddStringToObject(p, "object", "no_such_collection_xyz");
        root = rpc("schema.ddl", p);
        EXPECT(is_error(root) && strstr(error_text(root), "not found") != NULL,
               "ddl of a missing collection is an error");
        cJSON_Delete(root);
    }

    expect_cmd(conn_id, "db.quaero_w.dropIndex('by_n')", 0, "nIndexesWas", "3");
    expect_cmd(conn_id, "db.quaero_w.dropIndex({name: 1})", 0, "nIndexesWas", "2");
    expect_cmd_error(conn_id, "db.quaero_w.dropIndex('nope')", 0, "");

    /* --- a view: created, and its definition round-trips through get_ddl --- */
    cJSON_Delete(run(conn_id, "db.quaero_wv.drop()"));
    expect_cmd(conn_id,
               "db.createView('quaero_wv', 'quaero_w', [{$match: {n: {$gt: 5}}}])", 0, "created",
               "quaero_wv");
    {
        cJSON *p = params_for(conn_id);
        cJSON_AddStringToObject(p, "object", "quaero_wv");
        root = rpc("schema.ddl", p);
        EXPECT(strstr(first_cell(root, "sql"),
                      "db.createView(\"quaero_wv\", \"quaero_w\", [ { \"$match\" : { \"n\" : { \"$gt\" : 5 } } } ]);") !=
                   NULL,
               "ddl of a view is a createView call");
        cJSON_Delete(root);
    }
    expect_cmd(conn_id, "db.quaero_wv.drop()", 0, "dropped", "quaero_wv");

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

/* Open a second connection on `dsn`; returns 1 and fills conn_id on success. */
static int open_conn(const char *dsn, char *conn_id, size_t cap)
{
    char req[1024];
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":%d,\"method\":\"conn.open\","
             "\"params\":{\"driver\":\"mongodb\",\"dsn\":%s}}",
             g_rpc_id++, dsn);
    cJSON *root = call(req);
    cJSON *cid = cJSON_GetObjectItem(result_of(root), "connId");
    int ok = cJSON_IsString(cid);
    if (ok) {
        snprintf(conn_id, cap, "%s", cid->valuestring);
    }
    cJSON_Delete(root);
    return ok;
}

static void close_conn(const char *conn_id)
{
    cJSON_Delete(rpc("conn.close", params_for(conn_id)));
}

/* The JSON-RPC error code of a response, or 0. */
static int error_code(cJSON *root)
{
    cJSON *c = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "error"), "code");
    return cJSON_IsNumber(c) ? (int)c->valuedouble : 0;
}

/* Run `sql` and require `want` rows. */
static void expect_rows(const char *conn_id, const char *sql, int want)
{
    cJSON *root = run(conn_id, sql);
    char msg[400];
    snprintf(msg, sizeof msg, "%s returns %d row(s) (got %d%s%s)", sql, want, row_count(root),
             is_error(root) ? ": " : "", is_error(root) ? error_text(root) : "");
    EXPECT(!is_error(root) && row_count(root) == want, msg);
    cJSON_Delete(root);
}

/*
 * Execution plans, the operations monitor, the profiler, rename and collection
 * management (the commands behind the plan view, the server monitor, the
 * slow-queries tool and the tree). `db_name` is the connection's database.
 */
static void ops_section(const char *conn_id, const char *db_name)
{
    cJSON *root;
    char msg[400];

    cJSON_Delete(run(conn_id, "db.quaero_w.drop()"));
    expect_cmd(conn_id, "db.createCollection('quaero_w')", 0, "created", "quaero_w");
    expect_cmd(conn_id, "db.quaero_w.insertMany([{_id: 1, n: 5}, {_id: 2, n: 15}, {_id: 3, n: 25}])",
               3, "insertedCount", "3");
    expect_cmd(conn_id, "db.quaero_w.createIndex({n: 1})", 0, "name", "n_1");

    /* --- explain: the winning plan, as a result row ------------------------ */
    root = run(conn_id, "db.quaero_w.find({n: {$gt: 10}}).sort({n: 1}).limit(5).explain()");
    EXPECT(!is_error(root), "find().explain() succeeds");
    EXPECT(strstr(first_cell(root, "queryPlanner"), "winningPlan") != NULL,
           "explain returns the queryPlanner with its winningPlan");
    EXPECT(strstr(first_cell(root, "queryPlanner"), "IXSCAN") != NULL,
           "the plan uses the n_1 index");
    EXPECT(strcmp(first_cell(root, "executionStats"), "") == 0,
           "queryPlanner verbosity does not run the query (no executionStats)");
    cJSON_Delete(root);
    root = run(conn_id, "db.quaero_w.find({n: {$gt: 10}}).explain('executionStats')");
    EXPECT(strstr(first_cell(root, "executionStats"), "nReturned") != NULL,
           "executionStats verbosity adds the execution statistics");
    cJSON_Delete(root);
    root = run(conn_id, "db.quaero_w.aggregate([{$match: {n: {$gt: 10}}}, {$count: 'k'}]).explain()");
    EXPECT(!is_error(root) && (strstr(first_cell(root, "queryPlanner"), "winningPlan") != NULL ||
                               strstr(first_cell(root, "stages"), "$cursor") != NULL),
           "aggregate().explain() returns a plan");
    cJSON_Delete(root);
    expect_cmd_error(conn_id, "db.quaero_w.find({n: {$bad: 1}}).explain()", 0, "");
    expect_cmd_error(conn_id, "db.quaero_w.find().explain('chatty')", 0, "queryPlanner");
    expect_cmd_error(conn_id, "db.quaero_w.insertOne({a: 1}).explain()", 0, "");
    expect_rows(conn_id, "db.quaero_w.find({n: {$gt: 10}})", 2); /* a plain find still runs */

    /* --- the operations monitor -------------------------------------------- */
    root = run(conn_id, "db.currentOp()");
    snprintf(msg, sizeof msg, "currentOp succeeds (%s)", is_error(root) ? error_text(root) : "ok");
    EXPECT(!is_error(root), msg);
    EXPECT(result_of(root) != NULL && col_index(result_of(root), "opid") >= 0,
           "currentOp lists operations with their opid");
    cJSON_Delete(root);
    root = run(conn_id, "db.currentOp({$ownOps: true})");
    EXPECT(!is_error(root), "currentOp({$ownOps: true}) succeeds");
    cJSON_Delete(root);
    expect_rows(conn_id, "db.currentOp({ns: 'no.such.namespace'})", 0);
    expect_cmd_error(conn_id, "db.killOp('not a number')", 0, "");
    expect_cmd_error(conn_id, "db.killOp(-1)", 0, "operation id");

    /* --- the profiler: slow-query data ------------------------------------- */
    expect_cmd(conn_id, "db.setProfilingLevel(0)", 0, "was", "0");
    expect_cmd(conn_id, "db.getProfilingStatus()", 0, "was", "0");
    cJSON_Delete(run(conn_id, "db.system.profile.drop()"));
    expect_cmd(conn_id, "db.setProfilingLevel(2, 0)", 0, "was", "0");
    expect_cmd(conn_id, "db.getProfilingStatus()", 0, "was", "2");
    expect_rows(conn_id, "db.quaero_w.find({n: 5})", 1);
    root = run(conn_id, "db.system.profile.find({op: 'query'}).sort({millis: -1}).limit(5)");
    EXPECT(!is_error(root) && row_count(root) >= 1 && col_index(result_of(root), "millis") >= 0,
           "db.system.profile.find() lists the recorded operations with their millis");
    cJSON_Delete(root);
    /* The slow-queries tool's grouped listing (frontend/src/utils/slowQueries.ts). */
    root = run(conn_id,
               "db.system.profile.aggregate([{$match: {ns: {$not: {$regex: '\\\\.system\\\\.'}}}}, "
               "{$sort: {millis: -1}}, {$group: {_id: {ns: '$ns', op: "
               "'$op', qh: '$queryHash'}, query: {$first: '$command'}, ejecuciones: {$sum: 1}, "
               "avg_ms: {$avg: '$millis'}, total_ms: {$sum: '$millis'}, max_ms: {$max: '$millis'}}}, "
               "{$sort: {total_ms: -1}}, {$limit: 50}, {$project: {_id: 0, ns: '$_id.ns', op: "
               "'$_id.op', query: 1, ejecuciones: 1, avg_ms: {$round: ['$avg_ms', 2]}, total_ms: 1, "
               "max_ms: 1}}])");
    snprintf(msg, sizeof msg, "the grouped profile listing runs (%s)",
             is_error(root) ? error_text(root) : "ok");
    EXPECT(!is_error(root) && row_count(root) >= 1 && col_index(result_of(root), "query") >= 0 &&
               col_index(result_of(root), "ejecuciones") >= 0,
           msg);
    cJSON_Delete(root);
    expect_cmd(conn_id, "db.setProfilingLevel(0)", 0, "was", "2");
    expect_cmd_error(conn_id, "db.setProfilingLevel(3)", 0, "level");
    cJSON_Delete(run(conn_id, "db.system.profile.drop()"));

    /* --- collection management: infos, a view, rename, drop ----------------- */
    cJSON_Delete(run(conn_id, "db.quaero_wv.drop()"));
    expect_cmd(conn_id, "db.createView('quaero_wv', 'quaero_w', [{$match: {n: {$gt: 5}}}])", 0,
               "created", "quaero_wv");
    root = run(conn_id, "db.getCollectionInfos({name: 'quaero_wv'})");
    EXPECT(!is_error(root) && row_count(root) == 1 && strcmp(first_cell(root, "type"), "view") == 0,
           "getCollectionInfos reports the view with type view");
    cJSON_Delete(root);
    root = run(conn_id, "db.getCollectionInfos({type: 'collection', name: 'quaero_w'})");
    EXPECT(!is_error(root) && row_count(root) == 1, "getCollectionInfos filters by type and name");
    cJSON_Delete(root);

    /* The tree lists the view as a view and the collection as a collection. */
    {
        cJSON *p = params_for(conn_id);
        cJSON_AddStringToObject(p, "db", db_name);
        root = rpc("schema.tree", p);
        cJSON *res = result_of(root);
        int ni = res ? col_index(res, "name") : -1, ti = res ? col_index(res, "type") : -1;
        int saw_view = 0, saw_coll = 0;
        for (int r = 0; ni >= 0 && ti >= 0 && r < row_count(root); r++) {
            cJSON *nm = cell(res, r, ni), *ty = cell(res, r, ti);
            if (cJSON_IsString(nm) && cJSON_IsString(ty)) {
                saw_view |= strcmp(nm->valuestring, "quaero_wv") == 0 &&
                            strcmp(ty->valuestring, "view") == 0;
                saw_coll |= strcmp(nm->valuestring, "quaero_w") == 0 &&
                            strcmp(ty->valuestring, "collection") == 0;
            }
        }
        EXPECT(saw_view, "schema.tree lists the view with type view");
        EXPECT(saw_coll, "schema.tree lists the collection with type collection");
        cJSON_Delete(root);
    }
    expect_cmd(conn_id, "db.quaero_wv.drop()", 0, "dropped", "quaero_wv");

    cJSON_Delete(run(conn_id, "db.quaero_r1.drop()"));
    cJSON_Delete(run(conn_id, "db.quaero_r2.drop()"));
    expect_cmd(conn_id, "db.quaero_r1.insertOne({_id: 1, v: 'one'})", 1, NULL, NULL);
    expect_cmd(conn_id, "db.quaero_r2.insertOne({_id: 2, v: 'two'})", 1, NULL, NULL);
    expect_cmd_error(conn_id, "db.quaero_r1.renameCollection('quaero_r2')", 0, "exists");
    expect_cmd(conn_id, "db.quaero_r1.renameCollection('quaero_r3')", 0, "to", "quaero_r3");
    expect_rows(conn_id, "db.quaero_r3.find({v: 'one'})", 1);
    expect_cmd_error(conn_id, "db.quaero_r1.renameCollection('quaero_r4')", 0, "");
    expect_cmd(conn_id, "db.quaero_r3.renameCollection('quaero_r2', true)", 0, "renamed", "quaero_r3");
    expect_rows(conn_id, "db.quaero_r2.find()", 1);
    expect_rows(conn_id, "db.getCollection('quaero_r2').find({v: 'one'})", 1);
    /* Emptying a collection from the tree is deleteMany({}); dropping is drop(). */
    expect_cmd(conn_id, "db.quaero_r2.deleteMany({})", 1, "deletedCount", "1");
    expect_cmd(conn_id, "db.quaero_r2.drop()", 0, "dropped", "quaero_r2");

    /* --- index management as the index manager drives it -------------------- */
    root = run(conn_id, "db.quaero_w.getIndexes()");
    EXPECT(!is_error(root) && row_count(root) == 2 && col_index(result_of(root), "name") >= 0 &&
               col_index(result_of(root), "key") >= 0,
           "getIndexes lists name and key (the index manager's columns)");
    cJSON_Delete(root);
    expect_cmd(conn_id, "db.quaero_w.createIndex({\"n\": 1, \"_id\": 1}, {\"name\": \"by_n_id\", \"unique\": true})",
               0, "name", "by_n_id");
    root = run(conn_id, "db.quaero_w.getIndexes()");
    EXPECT(row_count(root) == 3, "the new index is listed");
    cJSON_Delete(root);
    expect_cmd(conn_id, "db.quaero_w.dropIndex(\"by_n_id\")", 0, "ok", "1");

    expect_cmd(conn_id, "db.quaero_w.drop()", 0, "dropped", "quaero_w");
}

/*
 * Multi-document transactions. A standalone server has none, and the driver says
 * so: tx.begin fails with the UNSUPPORTED code and a message naming the replica
 * set (the frontend's edit session keys on exactly that to apply changes as it
 * goes). On a replica set the full behaviour is checked: operations join the
 * transaction, other connections see nothing until commit, rollback discards, and
 * a failed operation leaves a transaction that can still be rolled back.
 */
static void tx_section(const char *dsn, const char *conn_id)
{
    cJSON *root;
    char msg[400];

    /* Outside a transaction, commit and rollback are errors, not silent successes. */
    root = rpc("tx.commit", params_for(conn_id));
    EXPECT(is_error(root), "tx.commit with no transaction is an error");
    cJSON_Delete(root);
    root = rpc("tx.rollback", params_for(conn_id));
    EXPECT(is_error(root), "tx.rollback with no transaction is an error");
    cJSON_Delete(root);

    cJSON_Delete(run(conn_id, "db.quaero_tx.drop()"));
    expect_cmd(conn_id, "db.createCollection('quaero_tx')", 0, "created", "quaero_tx");

    root = rpc("tx.begin", params_for(conn_id));
    if (is_error(root)) {
        snprintf(msg, sizeof msg, "tx.begin on a server without transactions is UNSUPPORTED (code %d)",
                 error_code(root));
        EXPECT(error_code(root) == -32001, msg);
        snprintf(msg, sizeof msg, "the message says why (got '%s')", error_text(root));
        EXPECT(strstr(error_text(root), "replica set") != NULL, msg);
        cJSON_Delete(root);
        /* Nothing was opened: statements still run directly. */
        expect_cmd(conn_id, "db.quaero_tx.insertOne({_id: 1})", 1, NULL, NULL);
        printf("NOTE: standalone server: transactions reported unsupported (the replica-set "
               "checks need QUAERO_MONGODB_RS_DSN)\n");
        expect_cmd(conn_id, "db.quaero_tx.drop()", 0, "dropped", "quaero_tx");
        return;
    }
    cJSON_Delete(root);

    char other[32] = "";
    EXPECT(open_conn(dsn, other, sizeof other), "a second connection opens");

    /* Operations join the transaction; another connection sees nothing yet. */
    expect_cmd(conn_id, "db.quaero_tx.insertOne({_id: 1, v: 'in-tx'})", 1, NULL, NULL);
    expect_cmd(conn_id, "db.quaero_tx.insertMany([{_id: 2, v: 'b'}, {_id: 3, v: 'c'}])", 2, NULL, NULL);
    expect_cmd(conn_id, "db.quaero_tx.countDocuments({})", 0, "count", "3");
    expect_rows(conn_id, "db.quaero_tx.find({v: 'b'})", 1);
    expect_cmd(conn_id, "db.quaero_tx.updateMany({_id: {$gt: 1}}, {$set: {w: 1}})", 2, "modifiedCount", "2");
    expect_cmd(conn_id, "db.quaero_tx.replaceOne({_id: 3}, {v: 'cc'})", 1, "matchedCount", "1");
    expect_rows(conn_id, "db.quaero_tx.aggregate([{$match: {_id: {$gte: 2}}}])", 2);
    expect_cmd(conn_id, "db.quaero_tx.deleteOne({_id: 3})", 1, "deletedCount", "1");
    root = run(conn_id, "db.quaero_tx.distinct('v')");
    EXPECT(!is_error(root) && row_count(root) == 2, "distinct runs in the transaction");
    cJSON_Delete(root);
    root = run(conn_id, "db.quaero_tx.getIndexes()");
    EXPECT(!is_error(root) && row_count(root) == 1,
           "getIndexes works while a transaction is open (it stays outside it)");
    cJSON_Delete(root);
    expect_cmd(conn_id, "db.runCommand({find: 'quaero_tx', filter: {_id: 1}})", 0, "ok", "1");
    expect_cmd(other, "db.quaero_tx.countDocuments({})", 0, "count", "0");

    /* Opening a second transaction on the same connection is refused. */
    root = rpc("tx.begin", params_for(conn_id));
    EXPECT(is_error(root) && strstr(error_text(root), "already") != NULL,
           "tx.begin inside a transaction is refused");
    cJSON_Delete(root);

    root = rpc("tx.commit", params_for(conn_id));
    snprintf(msg, sizeof msg, "tx.commit succeeds (%s)", is_error(root) ? error_text(root) : "ok");
    EXPECT(!is_error(root), msg);
    cJSON_Delete(root);
    expect_cmd(other, "db.quaero_tx.countDocuments({})", 0, "count", "2");

    /* Statements after the commit are not in a transaction any more. */
    expect_cmd(conn_id, "db.quaero_tx.insertOne({_id: 10})", 1, NULL, NULL);
    expect_cmd(other, "db.quaero_tx.countDocuments({})", 0, "count", "3");

    /* A rollback discards everything since begin. */
    EXPECT(!is_error(root = rpc("tx.begin", params_for(conn_id))), "tx.begin again");
    cJSON_Delete(root);
    expect_cmd(conn_id, "db.quaero_tx.deleteMany({})", 3, "deletedCount", "3");
    expect_cmd(conn_id, "db.quaero_tx.insertOne({_id: 20})", 1, NULL, NULL);
    root = rpc("tx.rollback", params_for(conn_id));
    EXPECT(!is_error(root), "tx.rollback succeeds");
    cJSON_Delete(root);
    expect_cmd(other, "db.quaero_tx.countDocuments({})", 0, "count", "3");
    expect_cmd(conn_id, "db.quaero_tx.countDocuments({})", 0, "count", "3");

    /* A failing operation (duplicate key) aborts the server-side transaction; the
       rollback that follows still succeeds and leaves the data as it was. */
    EXPECT(!is_error(root = rpc("tx.begin", params_for(conn_id))), "tx.begin after a rollback");
    cJSON_Delete(root);
    expect_cmd(conn_id, "db.quaero_tx.insertOne({_id: 30})", 1, NULL, NULL);
    expect_cmd_error(conn_id, "db.quaero_tx.insertOne({_id: 10})", 0, "duplicate key");
    root = rpc("tx.rollback", params_for(conn_id));
    snprintf(msg, sizeof msg, "tx.rollback after a failed operation succeeds (%s)",
             is_error(root) ? error_text(root) : "ok");
    EXPECT(!is_error(root), msg);
    cJSON_Delete(root);
    expect_cmd(conn_id, "db.quaero_tx.countDocuments({})", 0, "count", "3");

    /* Closing the connection with a transaction open abandons it. */
    {
        char third[32] = "";
        EXPECT(open_conn(dsn, third, sizeof third), "a third connection opens");
        EXPECT(!is_error(root = rpc("tx.begin", params_for(third))), "tx.begin on the third");
        cJSON_Delete(root);
        expect_cmd(third, "db.quaero_tx.insertOne({_id: 40})", 1, NULL, NULL);
        close_conn(third);
        expect_cmd(other, "db.quaero_tx.countDocuments({})", 0, "count", "3");
    }

    close_conn(other);
    expect_cmd(conn_id, "db.quaero_tx.drop()", 0, "dropped", "quaero_tx");
}

/*
 * A user with only the read role: the monitor, profiler and rename commands must
 * fail with the SERVER's own message (never an empty list or a fake success),
 * while the user's own operations and plans stay available. Optional: runs when
 * QUAERO_MONGODB_RO_DSN names such a user on a server with access control (the
 * CI service has none, so it is skipped there).
 */
static void privilege_section(const char *ro_dsn)
{
    char ro[32] = "";
    EXPECT(open_conn(ro_dsn, ro, sizeof ro), "the read-only connection opens");
    if (ro[0] == '\0') {
        return;
    }
    expect_cmd_error(ro, "db.currentOp()", 0, "not authorized");
    cJSON *root = run(ro, "db.currentOp({$ownOps: true})");
    EXPECT(!is_error(root), "currentOp({$ownOps: true}) works without the inprog privilege");
    cJSON_Delete(root);
    expect_cmd_error(ro, "db.setProfilingLevel(1)", 0, "not authorized");
    expect_cmd_error(ro, "db.quaero_it.renameCollection('quaero_it_x')", 0, "not authorized");
    expect_cmd_error(ro, "db.quaero_it.insertOne({_id: 99})", 0, "not authorized");
    root = run(ro, "db.quaero_it.find().explain()");
    EXPECT(!is_error(root) && strstr(first_cell(root, "queryPlanner"), "winningPlan") != NULL,
           "a read-only user can still explain a find");
    cJSON_Delete(root);
    close_conn(ro);
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

    /* The connection's database, for the calls that name it. */
    char db_name[128] = "test";
    {
        cJSON *d = cJSON_Parse(dsn);
        cJSON *name = d != NULL ? cJSON_GetObjectItem(d, "database") : NULL;
        if (cJSON_IsString(name) && name->valuestring[0] != '\0') {
            snprintf(db_name, sizeof db_name, "%s", name->valuestring);
        }
        cJSON_Delete(d);
    }
    ops_section(conn_id, db_name);
    tx_section(dsn, conn_id);

    /* The replica-set half of the transaction checks, when a replica set is
       provided (CI starts one); otherwise they are skipped with a note, and the
       standalone half above has already checked the explicit refusal. */
    const char *rs_dsn = getenv("QUAERO_MONGODB_RS_DSN");
    if (rs_dsn != NULL && rs_dsn[0] != '\0') {
        char rs_conn[32] = "";
        EXPECT(open_conn(rs_dsn, rs_conn, sizeof rs_conn), "the replica-set connection opens");
        if (rs_conn[0] != '\0') {
            cJSON *probe = rpc("tx.begin", params_for(rs_conn));
            EXPECT(!is_error(probe), "QUAERO_MONGODB_RS_DSN points at a server with transactions");
            if (!is_error(probe)) {
                cJSON_Delete(rpc("tx.rollback", params_for(rs_conn)));
                tx_section(rs_dsn, rs_conn);
            }
            cJSON_Delete(probe);
            close_conn(rs_conn);
        }
    } else {
        printf("NOTE: QUAERO_MONGODB_RS_DSN not set; replica-set transaction checks skipped\n");
    }

    const char *ro_dsn = getenv("QUAERO_MONGODB_RO_DSN");
    if (ro_dsn != NULL && ro_dsn[0] != '\0') {
        privilege_section(ro_dsn);
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
        printf("OK: MongoDB integration (conn + query + writes + DML + DDL + plans + ops + tx over IPC)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
