#include "internal.h"
#include "utils/query_parse.h"
#include "utils/result.h"

#include <stdlib.h>
#include <string.h>

/*
 * Plans, running operations, the profiler, rename and collection infos: the
 * mongosh commands behind the editor's execution plan, the server monitor and
 * the slow-queries tool, and the tree's collection management.
 *
 *   find/aggregate ... .explain(v)  -> the explain command, flattened to one row
 *                                      (queryPlanner / executionStats as JSON cells)
 *   db.currentOp(filter?)           -> one row per operation ($currentOp)
 *   db.killOp(opid)                 -> killOp
 *   db.setProfilingLevel / db.getProfilingStatus -> the profile command
 *   db.coll.renameCollection(new)   -> rename
 *   db.getCollectionInfos(filter?)  -> one row per collection / view
 *
 * Privileges are the server's: a user without `inprog` / `killop` / `dbAdmin`
 * gets the server's own "not authorized" message as the error, never an empty
 * list. None of these runs inside a transaction (the server does not allow it).
 */

/* Append every field of the document text `text` (relaxed JSON) to `dst`. */
static dbc_status concat_doc(dbc_conn *c, bson_t *dst, const char *text, const char *what)
{
    bson_error_t berr;
    bson_t *doc = mongo_bson_from_relaxed(text, &berr);
    if (doc == NULL) {
        return mongo_fail_bson(c, what, &berr);
    }
    bson_concat(dst, doc);
    bson_destroy(doc);
    return DBC_OK;
}

/* ---- explain ------------------------------------------------------------ */

dbc_status mongo_explain_exec(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    *out = NULL;
    bson_error_t berr;
    bson_t cmd = BSON_INITIALIZER, inner = BSON_INITIALIZER;
    bson_t *filter = NULL, *tmp = NULL;
    dbc_status st = DBC_ERR_QUERY;

    BSON_APPEND_UTF8(&inner, q->op == MONGO_OP_FIND ? "find" : "aggregate", q->collection);
    if (q->op == MONGO_OP_FIND) {
        filter = mongo_bson_from_relaxed(q->filter, &berr);
        if (filter == NULL) {
            st = mongo_fail_bson(c, "invalid filter", &berr);
            goto done;
        }
        BSON_APPEND_DOCUMENT(&inner, "filter", filter);
        if (q->projection != NULL) {
            tmp = mongo_bson_from_relaxed(q->projection, &berr);
            if (tmp == NULL) {
                st = mongo_fail_bson(c, "invalid projection", &berr);
                goto done;
            }
            BSON_APPEND_DOCUMENT(&inner, "projection", tmp);
            bson_destroy(tmp);
            tmp = NULL;
        }
        if (q->sort != NULL) {
            tmp = mongo_bson_from_relaxed(q->sort, &berr);
            if (tmp == NULL) {
                st = mongo_fail_bson(c, "invalid sort", &berr);
                goto done;
            }
            BSON_APPEND_DOCUMENT(&inner, "sort", tmp);
            bson_destroy(tmp);
            tmp = NULL;
        }
        if (q->skip >= 0) {
            BSON_APPEND_INT64(&inner, "skip", q->skip);
        }
        if (q->limit >= 0) {
            BSON_APPEND_INT64(&inner, "limit", q->limit);
        }
    } else {
        bson_iter_t it;
        tmp = mongo_bson_wrap_relaxed("pipeline", q->filter, &berr);
        if (tmp == NULL) {
            st = mongo_fail_bson(c, "invalid pipeline", &berr);
            goto done;
        }
        if (!bson_iter_init_find(&it, tmp, "pipeline") || !BSON_ITER_HOLDS_ARRAY(&it)) {
            st = mongo_fail_msg(c, DBC_ERR_QUERY, "aggregate() takes a pipeline array");
            goto done;
        }
        bson_append_value(&inner, "pipeline", -1, bson_iter_value(&it));
        bson_t cursor;
        BSON_APPEND_DOCUMENT_BEGIN(&inner, "cursor", &cursor);
        bson_append_document_end(&inner, &cursor);
    }

    BSON_APPEND_DOCUMENT(&cmd, "explain", &inner);
    BSON_APPEND_UTF8(&cmd, "verbosity", q->explain);
    st = mongo_run_admin_command(c, c->db, &cmd, "explain failed", out);

done:
    if (filter != NULL) {
        bson_destroy(filter);
    }
    if (tmp != NULL) {
        bson_destroy(tmp);
    }
    bson_destroy(&inner);
    bson_destroy(&cmd);
    return st;
}

/* ---- currentOp / killOp -------------------------------------------------- */

/* The special keys mongosh's currentOp takes besides a filter. */
static int is_current_op_option(const char *key)
{
    return strcmp(key, "$ownOps") == 0 || strcmp(key, "$all") == 0;
}

static int truthy(const bson_iter_t *it)
{
    if (BSON_ITER_HOLDS_BOOL(it)) {
        return bson_iter_bool(it);
    }
    if (BSON_ITER_HOLDS_INT32(it)) {
        return bson_iter_int32(it) != 0;
    }
    return 0;
}

/* The documents of a command reply's cursor.firstBatch, copied (the caller
   destroys each and frees the array). *n is the count. DBC_OK also for an empty
   batch. */
static dbc_status first_batch(dbc_conn *c, const bson_t *reply, bson_t ***docs_out, int *n_out)
{
    bson_t **docs = NULL;
    int n = 0, cap = 0;
    dbc_status st = DBC_OK;
    bson_iter_t cur, batch, el;
    if (bson_iter_init_find(&cur, reply, "cursor") && BSON_ITER_HOLDS_DOCUMENT(&cur) &&
        bson_iter_recurse(&cur, &el) && bson_iter_find(&el, "firstBatch") &&
        BSON_ITER_HOLDS_ARRAY(&el) && bson_iter_recurse(&el, &batch)) {
        while (bson_iter_next(&batch) && BSON_ITER_HOLDS_DOCUMENT(&batch)) {
            if (n >= cap) {
                int nc = cap == 0 ? 32 : cap * 2;
                bson_t **grown = realloc(docs, (size_t)nc * sizeof *grown);
                if (grown == NULL) {
                    st = mongo_fail_msg(c, DBC_ERR_NOMEM, "out of memory");
                    break;
                }
                docs = grown;
                cap = nc;
            }
            const uint8_t *data = NULL;
            uint32_t len = 0;
            bson_iter_document(&batch, &len, &data);
            docs[n] = bson_new_from_data(data, len);
            if (docs[n] == NULL) {
                st = mongo_fail_msg(c, DBC_ERR_NOMEM, "out of memory");
                break;
            }
            n++;
        }
    }
    *docs_out = docs;
    *n_out = n;
    return st;
}

static dbc_status op_current_op(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    bson_error_t berr;
    bson_t *user = NULL;
    if (q->nargs > 0) {
        user = mongo_bson_from_relaxed(q->args[0], &berr);
        if (user == NULL) {
            return mongo_fail_bson(c, "invalid currentOp filter", &berr);
        }
    }

    /* {$ownOps: true} limits the list to the caller's operations (the only form
       a user without the inprog privilege may run); {$all: true} adds idle
       connections and system operations. Everything else is a $match filter. */
    int own = 0, all = 0;
    bson_t match = BSON_INITIALIZER;
    bson_iter_t it;
    if (user != NULL && bson_iter_init(&it, user)) {
        while (bson_iter_next(&it)) {
            const char *key = bson_iter_key(&it);
            if (is_current_op_option(key)) {
                if (strcmp(key, "$ownOps") == 0) {
                    own = truthy(&it);
                } else {
                    all = truthy(&it);
                }
            } else {
                bson_append_value(&match, key, -1, bson_iter_value(&it));
            }
        }
    }

    bson_t cmd = BSON_INITIALIZER, pipeline, stage, inner, cursor;
    BSON_APPEND_INT32(&cmd, "aggregate", 1);
    BSON_APPEND_ARRAY_BEGIN(&cmd, "pipeline", &pipeline);
    BSON_APPEND_DOCUMENT_BEGIN(&pipeline, "0", &stage);
    BSON_APPEND_DOCUMENT_BEGIN(&stage, "$currentOp", &inner);
    BSON_APPEND_BOOL(&inner, "allUsers", !own);
    BSON_APPEND_BOOL(&inner, "idleConnections", all != 0);
    bson_append_document_end(&stage, &inner);
    bson_append_document_end(&pipeline, &stage);
    if (!bson_empty(&match)) {
        BSON_APPEND_DOCUMENT_BEGIN(&pipeline, "1", &stage);
        BSON_APPEND_DOCUMENT(&stage, "$match", &match);
        bson_append_document_end(&pipeline, &stage);
    }
    bson_append_array_end(&cmd, &pipeline);
    BSON_APPEND_DOCUMENT_BEGIN(&cmd, "cursor", &cursor);
    BSON_APPEND_INT32(&cursor, "batchSize", 10000);
    bson_append_document_end(&cmd, &cursor);

    bson_t reply;
    dbc_status st;
    if (!mongoc_client_command_with_opts(c->client, "admin", &cmd, NULL, NULL, &reply, &berr)) {
        st = mongo_fail_bson(c, "currentOp failed", &berr);
    } else {
        bson_t **docs = NULL;
        int n = 0;
        st = first_batch(c, &reply, &docs, &n);
        if (st == DBC_OK) {
            st = mongo_result_from_docs(c, docs, n, out);
        }
        for (int i = 0; i < n; i++) {
            bson_destroy(docs[i]);
        }
        free(docs);
    }
    bson_destroy(&reply);
    bson_destroy(&cmd);
    bson_destroy(&match);
    if (user != NULL) {
        bson_destroy(user);
    }
    return st;
}

static dbc_status op_kill_op(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    bson_t cmd = BSON_INITIALIZER;
    BSON_APPEND_INT32(&cmd, "killOp", 1);
    const char *arg = q->args[0];
    if (arg[0] == '"' || arg[0] == '\'') {
        /* A sharded cluster's operation id: "<shard>:<number>". */
        char *opid = mongo_unquote(arg);
        if (opid == NULL || opid[0] == '\0') {
            free(opid);
            bson_destroy(&cmd);
            return mongo_fail_msg(c, DBC_ERR_QUERY, "killOp() takes an operation id");
        }
        BSON_APPEND_UTF8(&cmd, "op", opid);
        free(opid);
    } else {
        char *end = NULL;
        long long v = strtoll(arg, &end, 10);
        if (end == arg || *end != '\0' || v < 0) {
            bson_destroy(&cmd);
            return mongo_fail_msg(c, DBC_ERR_QUERY,
                                  "killOp() takes the integer operation id from currentOp");
        }
        if (v <= 2147483647LL) {
            BSON_APPEND_INT32(&cmd, "op", (int32_t)v);
        } else {
            BSON_APPEND_INT64(&cmd, "op", v);
        }
    }
    dbc_status st = mongo_run_admin_command(c, "admin", &cmd, "killOp failed", out);
    bson_destroy(&cmd);
    return st;
}

/* ---- profiler ------------------------------------------------------------- */

static dbc_status op_set_profiling(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    char *end = NULL;
    long level = strtol(q->args[0], &end, 10);
    if (end == q->args[0] || *end != '\0' || level < 0 || level > 2) {
        return mongo_fail_msg(c, DBC_ERR_QUERY,
                              "setProfilingLevel() takes the level 0 (off), 1 (slow operations) "
                              "or 2 (all)");
    }
    bson_t cmd = BSON_INITIALIZER;
    BSON_APPEND_INT32(&cmd, "profile", (int32_t)level);
    dbc_status st = DBC_OK;
    if (q->nargs > 1) {
        if (q->args[1][0] == '{') {
            st = concat_doc(c, &cmd, q->args[1], "invalid profiling options");
        } else {
            long ms = strtol(q->args[1], &end, 10);
            if (end == q->args[1] || *end != '\0' || ms < 0) {
                st = mongo_fail_msg(c, DBC_ERR_QUERY, "slowms must be a non-negative integer");
            } else {
                BSON_APPEND_INT32(&cmd, "slowms", (int32_t)ms);
            }
        }
    }
    if (st == DBC_OK) {
        st = mongo_run_admin_command(c, c->db, &cmd, "setProfilingLevel failed", out);
    }
    bson_destroy(&cmd);
    return st;
}

static dbc_status op_get_profiling(dbc_conn *c, dbc_result **out)
{
    bson_t cmd = BSON_INITIALIZER;
    BSON_APPEND_INT32(&cmd, "profile", -1);
    dbc_status st = mongo_run_admin_command(c, c->db, &cmd, "getProfilingStatus failed", out);
    bson_destroy(&cmd);
    return st;
}

/* ---- collections ---------------------------------------------------------- */

static dbc_status op_rename(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                            dbc_result **out)
{
    char *target = mongo_unquote(q->args[0]);
    if (target == NULL || target[0] == '\0') {
        free(target);
        return mongo_fail_msg(c, DBC_ERR_QUERY, "renameCollection() takes the new collection name");
    }
    bool drop_target = q->nargs > 1 && strcmp(q->args[1], "true") == 0;
    bson_error_t berr;
    dbc_status st;
    if (!mongoc_collection_rename(coll, c->db, target, drop_target, &berr)) {
        st = mongo_fail_bson(c, "renameCollection failed", &berr);
    } else {
        bson_t ack = BSON_INITIALIZER;
        BSON_APPEND_INT32(&ack, "ok", 1);
        BSON_APPEND_UTF8(&ack, "renamed", q->collection);
        BSON_APPEND_UTF8(&ack, "to", target);
        st = mongo_finish_ack(c, &ack, 0, out);
        bson_destroy(&ack);
    }
    free(target);
    return st;
}

static dbc_status op_collection_infos(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    bson_t opts = BSON_INITIALIZER;
    dbc_status st = DBC_OK;
    if (q->nargs > 0) {
        bson_error_t berr;
        bson_t *filter = mongo_bson_from_relaxed(q->args[0], &berr);
        if (filter == NULL) {
            st = mongo_fail_bson(c, "invalid filter", &berr);
        } else {
            if (!bson_empty(filter)) {
                BSON_APPEND_DOCUMENT(&opts, "filter", filter);
            }
            bson_destroy(filter);
        }
    }
    if (st == DBC_OK && q->nargs > 1) {
        st = concat_doc(c, &opts, q->args[1], "invalid options");
    }
    if (st == DBC_OK) {
        mongoc_database_t *database = mongoc_client_get_database(c->client, c->db);
        mongoc_cursor_t *cursor = mongoc_database_find_collections_with_opts(database, &opts);
        if (cursor == NULL) {
            st = mongo_fail_msg(c, DBC_ERR_QUERY, "could not list collections");
        } else {
            st = mongo_result_from_cursor(c, cursor, "getCollectionInfos failed", out);
            mongoc_cursor_destroy(cursor);
        }
        mongoc_database_destroy(database);
    }
    bson_destroy(&opts);
    return st;
}

dbc_status mongo_admin_exec(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    *out = NULL;
    switch (q->op) {
    case MONGO_OP_CURRENT_OP:
        return op_current_op(c, q, out);
    case MONGO_OP_KILL_OP:
        return op_kill_op(c, q, out);
    case MONGO_OP_SET_PROFILING:
        return op_set_profiling(c, q, out);
    case MONGO_OP_GET_PROFILING:
        return op_get_profiling(c, out);
    case MONGO_OP_COLLECTION_INFOS:
        return op_collection_infos(c, q, out);
    case MONGO_OP_RENAME: {
        mongoc_collection_t *coll = mongoc_client_get_collection(c->client, c->db, q->collection);
        if (coll == NULL) {
            return mongo_fail_msg(c, DBC_ERR_QUERY, "could not open collection");
        }
        dbc_status st = op_rename(c, q, coll, out);
        mongoc_collection_destroy(coll);
        return st;
    }
    default:
        return mongo_fail_msg(c, DBC_ERR_UNSUPPORTED, "unsupported operation");
    }
}
