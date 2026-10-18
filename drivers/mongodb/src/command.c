#include "internal.h"
#include "utils/query_parse.h"
#include "utils/result.h"

#include <stdlib.h>
#include <string.h>

/*
 * Write and utility commands of the mongosh surface: insertOne/insertMany,
 * updateOne/updateMany/replaceOne, deleteOne/deleteMany, countDocuments,
 * distinct, createIndex/dropIndex/getIndexes, drop, createCollection,
 * createView and runCommand (find/aggregate live in query.c).
 *
 * Each command returns a result set shaped like mongosh's acknowledgement
 * (insertOne -> acknowledged, insertedId; updateOne -> acknowledged,
 * matchedCount, modifiedCount, upsertedCount[, upsertedId]; deleteOne ->
 * acknowledged, deletedCount ...), built as one BSON document and flattened by
 * the same code as find results. rows_affected is the real server count:
 * inserted documents, MATCHED documents for update/replace (plus an upserted one;
 * modifiedCount is in the result, as MySQL's "changed" vs "matched" distinction),
 * deleted documents; commands that change no documents report 0. A server error
 * (duplicate key, validation failure, bad update operator...) is returned as a
 * query error carrying the server's message.
 */

static dbc_status fail_bson(dbc_conn *c, const char *ctx, const bson_error_t *berr)
{
    mongo_stash_bson_error(c, ctx, berr);
    return DBC_ERR_QUERY;
}

static dbc_status fail_msg(dbc_conn *c, dbc_status st, const char *msg)
{
    mongo_set_err(c, msg);
    return st;
}

/* An integer-ish field of a server reply (int32/int64/double), else 0. */
static long long reply_int(const bson_t *reply, const char *key)
{
    bson_iter_t it;
    if (reply != NULL && bson_iter_init_find(&it, reply, key)) {
        if (BSON_ITER_HOLDS_INT32(&it)) {
            return bson_iter_int32(&it);
        }
        if (BSON_ITER_HOLDS_INT64(&it)) {
            return bson_iter_int64(&it);
        }
        if (BSON_ITER_HOLDS_DOUBLE(&it)) {
            return (long long)bson_iter_double(&it);
        }
    }
    return 0;
}

/* Copy a server reply's useful fields into `ack` (session / cluster-time
   plumbing is dropped). */
static void append_reply(bson_t *ack, const bson_t *reply, int keep_ok)
{
    static const char *const skip[] = {"operationTime", "lastCommittedOpTime", "electionId",
                                       "opTime", "$clusterTime", "$gleStats", "$configTime",
                                       "$topologyTime", "signature"};
    bson_iter_t it;
    if (reply == NULL || !bson_iter_init(&it, reply)) {
        return;
    }
    while (bson_iter_next(&it)) {
        const char *key = bson_iter_key(&it);
        int drop = (!keep_ok && strcmp(key, "ok") == 0);
        for (size_t i = 0; i < sizeof skip / sizeof skip[0] && !drop; i++) {
            drop = (strcmp(key, skip[i]) == 0);
        }
        if (!drop) {
            bson_append_value(ack, key, -1, bson_iter_value(&it));
        }
    }
}

/* Flatten `ack` (one row) and stamp rows_affected. */
static dbc_status finish(dbc_conn *c, bson_t *ack, long long affected, dbc_result **out)
{
    bson_t *docs[1] = {ack};
    dbc_status st = mongo_result_from_docs(c, docs, 1, out);
    if (st == DBC_OK && *out != NULL) {
        mongo_result_set_affected(*out, affected);
    }
    return st;
}

/* The optional options document at args[idx]: *opts stays NULL when absent.
   Returns DBC_OK, or an error status with the message stored. */
static dbc_status parse_opts(dbc_conn *c, const mongo_query *q, int idx, bson_t **opts)
{
    *opts = NULL;
    if (q->nargs <= idx) {
        return DBC_OK;
    }
    bson_error_t berr;
    *opts = mongo_bson_from_relaxed(q->args[idx], &berr);
    if (*opts == NULL) {
        return fail_bson(c, "invalid options", &berr);
    }
    return DBC_OK;
}

/* Prepend a generated ObjectId _id when `doc` has none (so insertedId can be
   reported); the result is a new document the caller destroys. */
static bson_t *with_id(const bson_t *doc)
{
    bson_t *out = bson_new();
    bson_iter_t it;
    if (!bson_iter_init_find(&it, doc, "_id")) {
        bson_oid_t oid;
        bson_oid_init(&oid, NULL);
        BSON_APPEND_OID(out, "_id", &oid);
    }
    bson_concat(out, doc);
    return out;
}

static dbc_status op_insert_one(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                                dbc_result **out)
{
    bson_error_t berr;
    bson_t *doc = mongo_bson_from_relaxed(q->args[0], &berr);
    if (doc == NULL) {
        return fail_bson(c, "invalid document", &berr);
    }
    bson_t *opts = NULL;
    dbc_status st = parse_opts(c, q, 1, &opts);
    if (st != DBC_OK) {
        bson_destroy(doc);
        return st;
    }

    bson_t *full = with_id(doc);
    bson_t reply;
    bool ok = mongoc_collection_insert_one(coll, full, opts, &reply, &berr);
    if (!ok) {
        st = fail_bson(c, "insertOne failed", &berr);
    } else {
        bson_t ack = BSON_INITIALIZER;
        BSON_APPEND_BOOL(&ack, "acknowledged", true);
        bson_iter_t it;
        if (bson_iter_init_find(&it, full, "_id")) {
            bson_append_value(&ack, "insertedId", -1, bson_iter_value(&it));
        }
        st = finish(c, &ack, 1, out);
        bson_destroy(&ack);
    }
    bson_destroy(&reply);
    bson_destroy(full);
    bson_destroy(doc);
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

static dbc_status op_insert_many(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                                 dbc_result **out)
{
    bson_error_t berr;
    bson_t *wrap = mongo_bson_wrap_relaxed("v", q->args[0], &berr);
    if (wrap == NULL) {
        return fail_bson(c, "invalid documents array", &berr);
    }
    bson_t *opts = NULL;
    dbc_status st = parse_opts(c, q, 1, &opts);
    if (st != DBC_OK) {
        bson_destroy(wrap);
        return st;
    }

    bson_t **docs = NULL;
    size_t n = 0;
    bson_iter_t it, arr;
    if (!bson_iter_init_find(&it, wrap, "v") || !BSON_ITER_HOLDS_ARRAY(&it) ||
        !bson_iter_recurse(&it, &arr)) {
        st = fail_msg(c, DBC_ERR_QUERY, "insertMany() takes an array of documents");
        goto done;
    }
    size_t cap = 0;
    while (bson_iter_next(&arr)) {
        if (!BSON_ITER_HOLDS_DOCUMENT(&arr)) {
            st = fail_msg(c, DBC_ERR_QUERY, "insertMany() documents must be objects");
            goto done;
        }
        if (n >= cap) {
            size_t nc = cap == 0 ? 16 : cap * 2;
            bson_t **grown = realloc(docs, nc * sizeof *grown);
            if (grown == NULL) {
                st = fail_msg(c, DBC_ERR_NOMEM, "out of memory");
                goto done;
            }
            docs = grown;
            cap = nc;
        }
        const uint8_t *data = NULL;
        uint32_t len = 0;
        bson_iter_document(&arr, &len, &data);
        bson_t sub;
        if (!bson_init_static(&sub, data, len)) {
            st = fail_msg(c, DBC_ERR_QUERY, "insertMany() got a malformed document");
            goto done;
        }
        docs[n] = with_id(&sub);
        if (docs[n] == NULL) {
            st = fail_msg(c, DBC_ERR_NOMEM, "out of memory");
            goto done;
        }
        n++;
    }
    if (n == 0) {
        st = fail_msg(c, DBC_ERR_QUERY, "insertMany() needs at least one document");
        goto done;
    }

    bson_t reply;
    bool ok = mongoc_collection_insert_many(coll, (const bson_t **)docs, n, opts, &reply, &berr);
    if (!ok) {
        st = fail_bson(c, "insertMany failed", &berr);
    } else {
        long long inserted = reply_int(&reply, "insertedCount");
        bson_t ack = BSON_INITIALIZER;
        BSON_APPEND_BOOL(&ack, "acknowledged", true);
        BSON_APPEND_INT64(&ack, "insertedCount", inserted);
        bson_t ids;
        BSON_APPEND_ARRAY_BEGIN(&ack, "insertedIds", &ids);
        for (size_t i = 0; i < n; i++) {
            char key[16];
            const char *k;
            bson_uint32_to_string((uint32_t)i, &k, key, sizeof key);
            bson_iter_t idit;
            if (bson_iter_init_find(&idit, docs[i], "_id")) {
                bson_append_value(&ids, k, -1, bson_iter_value(&idit));
            }
        }
        bson_append_array_end(&ack, &ids);
        st = finish(c, &ack, inserted, out);
        bson_destroy(&ack);
    }
    bson_destroy(&reply);

done:
    for (size_t i = 0; i < n; i++) {
        bson_destroy(docs[i]);
    }
    free(docs);
    bson_destroy(wrap);
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

/* updateOne / updateMany / replaceOne. */
static dbc_status op_update(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                            dbc_result **out)
{
    bson_error_t berr;
    bson_t *selector = mongo_bson_from_relaxed(q->args[0], &berr);
    if (selector == NULL) {
        return fail_bson(c, "invalid filter", &berr);
    }
    bson_t *opts = NULL;
    bson_t *upd_owner = NULL;   /* the parsed document, or the {v: [pipeline]} wrapper */
    bson_t pipeline;            /* static view of the pipeline array (when used) */
    const bson_t *update = NULL;
    dbc_status st = parse_opts(c, q, 2, &opts);
    if (st != DBC_OK) {
        goto done;
    }
    if (q->args[1][0] == '[') {
        upd_owner = mongo_bson_wrap_relaxed("v", q->args[1], &berr);
        bson_iter_t it;
        const uint8_t *data = NULL;
        uint32_t len = 0;
        if (upd_owner != NULL && bson_iter_init_find(&it, upd_owner, "v") &&
            BSON_ITER_HOLDS_ARRAY(&it)) {
            bson_iter_array(&it, &len, &data);
            if (bson_init_static(&pipeline, data, len)) {
                update = &pipeline;
            }
        }
        if (update == NULL) {
            st = fail_bson(c, "invalid update pipeline", &berr);
            goto done;
        }
    } else {
        upd_owner = mongo_bson_from_relaxed(q->args[1], &berr);
        update = upd_owner;
        if (update == NULL) {
            st = fail_bson(c, q->op == MONGO_OP_REPLACE_ONE ? "invalid replacement" : "invalid update",
                           &berr);
            goto done;
        }
    }

    bson_t reply;
    bool ok;
    const char *what;
    if (q->op == MONGO_OP_UPDATE_ONE) {
        ok = mongoc_collection_update_one(coll, selector, update, opts, &reply, &berr);
        what = "updateOne failed";
    } else if (q->op == MONGO_OP_UPDATE_MANY) {
        ok = mongoc_collection_update_many(coll, selector, update, opts, &reply, &berr);
        what = "updateMany failed";
    } else {
        ok = mongoc_collection_replace_one(coll, selector, update, opts, &reply, &berr);
        what = "replaceOne failed";
    }
    if (!ok) {
        st = fail_bson(c, what, &berr);
    } else {
        long long matched = reply_int(&reply, "matchedCount");
        long long upserted = reply_int(&reply, "upsertedCount");
        bson_t ack = BSON_INITIALIZER;
        BSON_APPEND_BOOL(&ack, "acknowledged", true);
        BSON_APPEND_INT64(&ack, "matchedCount", matched);
        BSON_APPEND_INT64(&ack, "modifiedCount", reply_int(&reply, "modifiedCount"));
        BSON_APPEND_INT64(&ack, "upsertedCount", upserted);
        bson_iter_t it;
        if (bson_iter_init_find(&it, &reply, "upsertedId")) {
            bson_append_value(&ack, "upsertedId", -1, bson_iter_value(&it));
        }
        st = finish(c, &ack, matched + upserted, out);
        bson_destroy(&ack);
    }
    bson_destroy(&reply);

done:
    bson_destroy(selector);
    if (upd_owner != NULL) {
        bson_destroy(upd_owner);
    }
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

/* deleteOne / deleteMany. */
static dbc_status op_delete(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                            dbc_result **out)
{
    bson_error_t berr;
    bson_t *selector = mongo_bson_from_relaxed(q->args[0], &berr);
    if (selector == NULL) {
        return fail_bson(c, "invalid filter", &berr);
    }
    bson_t *opts = NULL;
    dbc_status st = parse_opts(c, q, 1, &opts);
    if (st != DBC_OK) {
        bson_destroy(selector);
        return st;
    }
    bson_t reply;
    bool ok = (q->op == MONGO_OP_DELETE_ONE)
                  ? mongoc_collection_delete_one(coll, selector, opts, &reply, &berr)
                  : mongoc_collection_delete_many(coll, selector, opts, &reply, &berr);
    if (!ok) {
        st = fail_bson(c, "delete failed", &berr);
    } else {
        long long deleted = reply_int(&reply, "deletedCount");
        bson_t ack = BSON_INITIALIZER;
        BSON_APPEND_BOOL(&ack, "acknowledged", true);
        BSON_APPEND_INT64(&ack, "deletedCount", deleted);
        st = finish(c, &ack, deleted, out);
        bson_destroy(&ack);
    }
    bson_destroy(&reply);
    bson_destroy(selector);
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

static dbc_status op_count(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                           dbc_result **out)
{
    bson_error_t berr;
    bson_t *filter = mongo_bson_from_relaxed(q->nargs > 0 ? q->args[0] : "{}", &berr);
    if (filter == NULL) {
        return fail_bson(c, "invalid filter", &berr);
    }
    bson_t *opts = NULL;
    dbc_status st = parse_opts(c, q, 1, &opts);
    if (st == DBC_OK) {
        int64_t n = mongoc_collection_count_documents(coll, filter, opts, NULL, NULL, &berr);
        if (n < 0) {
            st = fail_bson(c, "countDocuments failed", &berr);
        } else {
            bson_t ack = BSON_INITIALIZER;
            BSON_APPEND_INT64(&ack, "count", n);
            st = finish(c, &ack, 0, out);
            bson_destroy(&ack);
        }
    }
    bson_destroy(filter);
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

/* distinct(): one row per distinct value, in a single "value" column. */
static dbc_status op_distinct(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                              dbc_result **out)
{
    char *field = mongo_unquote(q->args[0]);
    if (field == NULL || field[0] == '\0') {
        free(field);
        return fail_msg(c, DBC_ERR_QUERY, "distinct() field must be a non-empty string");
    }
    bson_error_t berr;
    bson_t *filter = NULL;
    bson_t *opts = NULL;
    dbc_status st = DBC_ERR_QUERY;
    if (q->nargs > 1) {
        filter = mongo_bson_from_relaxed(q->args[1], &berr);
        if (filter == NULL) {
            st = fail_bson(c, "invalid filter", &berr);
            goto done;
        }
    }
    st = parse_opts(c, q, 2, &opts);
    if (st != DBC_OK) {
        goto done;
    }

    bson_t cmd = BSON_INITIALIZER;
    BSON_APPEND_UTF8(&cmd, "distinct", q->collection);
    BSON_APPEND_UTF8(&cmd, "key", field);
    if (filter != NULL) {
        BSON_APPEND_DOCUMENT(&cmd, "query", filter);
    }
    bson_t reply;
    bool ok = mongoc_collection_read_command_with_opts(coll, &cmd, NULL, opts, &reply, &berr);
    st = DBC_ERR_QUERY;
    if (!ok) {
        st = fail_bson(c, "distinct failed", &berr);
    } else {
        dbc_result *r = mongo_result_new();
        bson_iter_t it, vals;
        if (r == NULL || mongo_result_add_column(r, "value", DBC_TYPE_NULL) != 0) {
            mongo_free_result(r);
            st = fail_msg(c, DBC_ERR_NOMEM, "out of memory");
        } else {
            st = DBC_OK;
            if (bson_iter_init_find(&it, &reply, "values") && BSON_ITER_HOLDS_ARRAY(&it) &&
                bson_iter_recurse(&it, &vals)) {
                int rows = 0;
                while (bson_iter_next(&vals) && rows < MONGO_SCAN_CAP) {
                    dbc_type t = DBC_TYPE_NULL;
                    int is_null = 0;
                    char *txt = mongo_bson_cell_text(&vals, &t, &is_null);
                    char **cells = calloc(1, sizeof *cells);
                    if ((!is_null && txt == NULL) || cells == NULL) {
                        free(txt);
                        free(cells);
                        st = fail_msg(c, DBC_ERR_NOMEM, "out of memory");
                        break;
                    }
                    cells[0] = txt;
                    if (mongo_result_add_row(r, cells) != 0) {
                        free(txt);
                        free(cells);
                        st = fail_msg(c, DBC_ERR_NOMEM, "out of memory");
                        break;
                    }
                    if (!is_null && mongo_col_type(r, 0) == DBC_TYPE_NULL) {
                        mongo_result_set_col_type(r, 0, t);
                    }
                    rows++;
                }
            }
            if (st == DBC_OK) {
                *out = r;
            } else {
                mongo_free_result(r);
            }
        }
    }
    bson_destroy(&reply);
    bson_destroy(&cmd);

done:
    free(field);
    if (filter != NULL) {
        bson_destroy(filter);
    }
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

static dbc_status op_create_index(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                                  dbc_result **out)
{
    bson_error_t berr;
    bson_t *keys = mongo_bson_from_relaxed(q->args[0], &berr);
    if (keys == NULL) {
        return fail_bson(c, "invalid index keys", &berr);
    }
    bson_t *opts = NULL;
    dbc_status st = parse_opts(c, q, 1, &opts);
    if (st != DBC_OK) {
        bson_destroy(keys);
        return st;
    }
    if (bson_empty(keys)) {
        bson_destroy(keys);
        if (opts != NULL) {
            bson_destroy(opts);
        }
        return fail_msg(c, DBC_ERR_QUERY, "createIndex() needs at least one key");
    }

    /* The index name: the explicit "name" option, else the conventional
       <field>_<dir>[_...] form (the same one mongosh and the server use). */
    char *generated = mongoc_collection_keys_to_index_string(keys);
    const char *name = generated;
    bson_iter_t it;
    if (opts != NULL && bson_iter_init_find(&it, opts, "name") && BSON_ITER_HOLDS_UTF8(&it)) {
        name = bson_iter_utf8(&it, NULL);
    }

    bson_t cmd = BSON_INITIALIZER, indexes, spec;
    BSON_APPEND_UTF8(&cmd, "createIndexes", q->collection);
    BSON_APPEND_ARRAY_BEGIN(&cmd, "indexes", &indexes);
    BSON_APPEND_DOCUMENT_BEGIN(&indexes, "0", &spec);
    BSON_APPEND_DOCUMENT(&spec, "key", keys);
    BSON_APPEND_UTF8(&spec, "name", name);
    if (opts != NULL && bson_iter_init(&it, opts)) {
        while (bson_iter_next(&it)) {
            const char *k = bson_iter_key(&it);
            if (strcmp(k, "key") != 0 && strcmp(k, "name") != 0) {
                bson_append_value(&spec, k, -1, bson_iter_value(&it));
            }
        }
    }
    bson_append_document_end(&indexes, &spec);
    bson_append_array_end(&cmd, &indexes);

    bson_t reply;
    if (!mongoc_collection_write_command_with_opts(coll, &cmd, NULL, &reply, &berr)) {
        st = fail_bson(c, "createIndex failed", &berr);
    } else {
        bson_t ack = BSON_INITIALIZER;
        BSON_APPEND_UTF8(&ack, "name", name);
        append_reply(&ack, &reply, 0);
        st = finish(c, &ack, 0, out);
        bson_destroy(&ack);
    }
    bson_destroy(&reply);
    bson_destroy(&cmd);
    bson_free(generated);
    bson_destroy(keys);
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

static dbc_status op_drop_index(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                                dbc_result **out)
{
    char *name = NULL;
    char *generated = NULL;
    bson_error_t berr;
    if (q->args[0][0] == '{') {
        bson_t *keys = mongo_bson_from_relaxed(q->args[0], &berr);
        if (keys == NULL) {
            return fail_bson(c, "invalid index keys", &berr);
        }
        generated = mongoc_collection_keys_to_index_string(keys);
        bson_destroy(keys);
    } else {
        name = mongo_unquote(q->args[0]);
        if (name == NULL || name[0] == '\0') {
            free(name);
            return fail_msg(c, DBC_ERR_QUERY, "dropIndex() takes an index name or its key pattern");
        }
    }

    bson_t cmd = BSON_INITIALIZER, reply;
    BSON_APPEND_UTF8(&cmd, "dropIndexes", q->collection);
    BSON_APPEND_UTF8(&cmd, "index", name != NULL ? name : generated);
    dbc_status st;
    if (!mongoc_collection_write_command_with_opts(coll, &cmd, NULL, &reply, &berr)) {
        st = fail_bson(c, "dropIndex failed", &berr);
    } else {
        bson_t ack = BSON_INITIALIZER;
        append_reply(&ack, &reply, 1);
        st = finish(c, &ack, 0, out);
        bson_destroy(&ack);
    }
    bson_destroy(&reply);
    bson_destroy(&cmd);
    free(name);
    bson_free(generated);
    return st;
}

static dbc_status op_get_indexes(dbc_conn *c, mongoc_collection_t *coll, dbc_result **out)
{
    mongoc_cursor_t *cursor = mongoc_collection_find_indexes_with_opts(coll, NULL);
    if (cursor == NULL) {
        return fail_msg(c, DBC_ERR_QUERY, "could not list indexes");
    }
    dbc_status st = mongo_result_from_cursor(c, cursor, "getIndexes failed", out);
    mongoc_cursor_destroy(cursor);
    return st;
}

static dbc_status op_drop(dbc_conn *c, const mongo_query *q, mongoc_collection_t *coll,
                          dbc_result **out)
{
    bson_t *opts = NULL;
    dbc_status st = parse_opts(c, q, 0, &opts);
    if (st != DBC_OK) {
        return st;
    }
    bson_error_t berr;
    if (!mongoc_collection_drop_with_opts(coll, opts, &berr)) {
        st = fail_bson(c, "drop failed", &berr);
    } else {
        bson_t ack = BSON_INITIALIZER;
        BSON_APPEND_BOOL(&ack, "acknowledged", true);
        BSON_APPEND_UTF8(&ack, "dropped", q->collection);
        st = finish(c, &ack, 0, out);
        bson_destroy(&ack);
    }
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

static dbc_status op_create_collection(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    char *name = mongo_unquote(q->args[0]);
    if (name == NULL || name[0] == '\0') {
        free(name);
        return fail_msg(c, DBC_ERR_QUERY, "createCollection() takes a non-empty collection name");
    }
    bson_t *opts = NULL;
    dbc_status st = parse_opts(c, q, 1, &opts);
    if (st != DBC_OK) {
        free(name);
        return st;
    }
    mongoc_database_t *database = mongoc_client_get_database(c->client, c->db);
    bson_error_t berr;
    mongoc_collection_t *created = mongoc_database_create_collection(database, name, opts, &berr);
    if (created == NULL) {
        st = fail_bson(c, "createCollection failed", &berr);
    } else {
        mongoc_collection_destroy(created);
        bson_t ack = BSON_INITIALIZER;
        BSON_APPEND_INT32(&ack, "ok", 1);
        BSON_APPEND_UTF8(&ack, "created", name);
        st = finish(c, &ack, 0, out);
        bson_destroy(&ack);
    }
    mongoc_database_destroy(database);
    free(name);
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

static dbc_status op_create_view(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    char *name = mongo_unquote(q->args[0]);
    char *source = mongo_unquote(q->args[1]);
    bson_error_t berr;
    bson_t *wrap = NULL, *opts = NULL;
    bson_t pipeline;
    dbc_status st = DBC_ERR_QUERY;
    int have_pipeline = 0;
    if (name == NULL || name[0] == '\0' || source == NULL || source[0] == '\0') {
        st = fail_msg(c, DBC_ERR_QUERY, "createView() takes the view name and its source collection");
        goto done;
    }
    wrap = mongo_bson_wrap_relaxed("v", q->args[2], &berr);
    bson_iter_t it;
    if (wrap != NULL && bson_iter_init_find(&it, wrap, "v") && BSON_ITER_HOLDS_ARRAY(&it)) {
        const uint8_t *data = NULL;
        uint32_t len = 0;
        bson_iter_array(&it, &len, &data);
        have_pipeline = bson_init_static(&pipeline, data, len);
    }
    if (!have_pipeline) {
        st = fail_bson(c, "invalid view pipeline", &berr);
        goto done;
    }
    st = parse_opts(c, q, 3, &opts);
    if (st != DBC_OK) {
        goto done;
    }

    bson_t cmd = BSON_INITIALIZER, reply;
    BSON_APPEND_UTF8(&cmd, "create", name);
    BSON_APPEND_UTF8(&cmd, "viewOn", source);
    BSON_APPEND_ARRAY(&cmd, "pipeline", &pipeline);
    if (opts != NULL && bson_iter_init(&it, opts)) {
        while (bson_iter_next(&it)) {
            bson_append_value(&cmd, bson_iter_key(&it), -1, bson_iter_value(&it));
        }
    }
    mongoc_database_t *database = mongoc_client_get_database(c->client, c->db);
    if (!mongoc_database_write_command_with_opts(database, &cmd, NULL, &reply, &berr)) {
        st = fail_bson(c, "createView failed", &berr);
    } else {
        bson_t ack = BSON_INITIALIZER;
        BSON_APPEND_INT32(&ack, "ok", 1);
        BSON_APPEND_UTF8(&ack, "created", name);
        st = finish(c, &ack, 0, out);
        bson_destroy(&ack);
    }
    bson_destroy(&reply);
    bson_destroy(&cmd);
    mongoc_database_destroy(database);

done:
    free(name);
    free(source);
    if (wrap != NULL) {
        bson_destroy(wrap);
    }
    if (opts != NULL) {
        bson_destroy(opts);
    }
    return st;
}

static dbc_status op_run_command(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    if (q->nargs > 1) {
        return fail_msg(c, DBC_ERR_UNSUPPORTED, "runCommand() options are not supported");
    }
    bson_error_t berr;
    bson_t *cmd = NULL;
    if (q->args[0][0] == '{') {
        cmd = mongo_bson_from_relaxed(q->args[0], &berr);
        if (cmd == NULL) {
            return fail_bson(c, "invalid command", &berr);
        }
    } else {
        /* runCommand("ping") is shorthand for runCommand({ping: 1}). */
        char *name = mongo_unquote(q->args[0]);
        if (name == NULL || name[0] == '\0') {
            free(name);
            return fail_msg(c, DBC_ERR_QUERY, "runCommand() takes a command document or a name");
        }
        cmd = bson_new();
        BSON_APPEND_INT32(cmd, name, 1);
        free(name);
    }
    if (bson_empty(cmd)) {
        bson_destroy(cmd);
        return fail_msg(c, DBC_ERR_QUERY, "runCommand() needs a non-empty command document");
    }

    bson_t reply;
    dbc_status st;
    if (!mongoc_client_command_with_opts(c->client, c->db, cmd, NULL, NULL, &reply, &berr)) {
        st = fail_bson(c, "command failed", &berr);
    } else {
        bson_t *docs[1] = {&reply};
        st = mongo_result_from_docs(c, docs, 1, out);
        if (st == DBC_OK && *out != NULL) {
            mongo_result_set_affected(*out, reply_int(&reply, "n"));
        }
    }
    bson_destroy(&reply);
    bson_destroy(cmd);
    return st;
}

dbc_status mongo_command_exec(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    *out = NULL;
    if (q->op == MONGO_OP_CREATE_COLLECTION) {
        return op_create_collection(c, q, out);
    }
    if (q->op == MONGO_OP_RUN_COMMAND) {
        return op_run_command(c, q, out);
    }
    if (q->op == MONGO_OP_CREATE_VIEW) {
        return op_create_view(c, q, out);
    }

    mongoc_collection_t *coll = mongoc_client_get_collection(c->client, c->db, q->collection);
    if (coll == NULL) {
        return fail_msg(c, DBC_ERR_QUERY, "could not open collection");
    }
    dbc_status st;
    switch (q->op) {
    case MONGO_OP_INSERT_ONE:   st = op_insert_one(c, q, coll, out); break;
    case MONGO_OP_INSERT_MANY:  st = op_insert_many(c, q, coll, out); break;
    case MONGO_OP_UPDATE_ONE:
    case MONGO_OP_UPDATE_MANY:
    case MONGO_OP_REPLACE_ONE:  st = op_update(c, q, coll, out); break;
    case MONGO_OP_DELETE_ONE:
    case MONGO_OP_DELETE_MANY:  st = op_delete(c, q, coll, out); break;
    case MONGO_OP_COUNT:        st = op_count(c, q, coll, out); break;
    case MONGO_OP_DISTINCT:     st = op_distinct(c, q, coll, out); break;
    case MONGO_OP_CREATE_INDEX: st = op_create_index(c, q, coll, out); break;
    case MONGO_OP_DROP_INDEX:   st = op_drop_index(c, q, coll, out); break;
    case MONGO_OP_GET_INDEXES:  st = op_get_indexes(c, coll, out); break;
    case MONGO_OP_DROP:         st = op_drop(c, q, coll, out); break;
    default:
        st = fail_msg(c, DBC_ERR_UNSUPPORTED, "unsupported operation");
        break;
    }
    mongoc_collection_destroy(coll);
    return st;
}
