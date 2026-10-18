#include "internal.h"
#include "utils/json_relax.h"
#include "utils/query_parse.h"
#include "utils/result.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Query execution: parse a mongosh-style command and run it via the
 * mongo-c-driver. find/aggregate are executed here and their documents
 * flattened into the neutral tabular result (docs.c); every other method (the
 * write and utility commands) is handled by command.c. An unknown method is
 * DBC_ERR_UNSUPPORTED -- never a fake success.
 */

/* The options every read carries: the open transaction's session, and the
   connection's cancel tag as the operation's `comment`, which is how cancel finds
   the operation on the server (cancel.c). */
static bool attach_read_opts(dbc_conn *c, bson_t *opts, bson_error_t *berr)
{
    if (c->cancel_tag[0] != '\0') {
        BSON_APPEND_UTF8(opts, "comment", c->cancel_tag);
    }
    return c->session == NULL || mongoc_client_session_append(c->session, opts, berr);
}

/* find / findOne / aggregate over `q`. */
static dbc_status run_read(dbc_conn *c, const mongo_query *q, dbc_result **out)
{
    dbc_status status = DBC_ERR_QUERY;
    mongoc_collection_t *coll = NULL;
    bson_t *filter = NULL;
    bson_t opts;
    bson_init(&opts);
    mongoc_cursor_t *cursor = NULL;
    bson_error_t berr;

    coll = mongoc_client_get_collection(c->client, c->db, q->collection);
    if (coll == NULL) {
        mongo_set_err(c, "could not open collection");
        goto done;
    }

    if (q->op == MONGO_OP_FIND) {
        filter = mongo_bson_from_relaxed(q->filter, &berr);
        if (filter == NULL) {
            mongo_stash_bson_error(c, "invalid filter", &berr);
            goto done;
        }
        if (q->projection != NULL) {
            bson_t proj;
            if (!mongo_bson_init_relaxed(&proj, q->projection, &berr)) {
                mongo_stash_bson_error(c, "invalid projection", &berr);
                goto done;
            }
            bson_append_document(&opts, "projection", -1, &proj);
            bson_destroy(&proj);
        }
        if (q->sort != NULL) {
            bson_t so;
            if (!mongo_bson_init_relaxed(&so, q->sort, &berr)) {
                mongo_stash_bson_error(c, "invalid sort", &berr);
                goto done;
            }
            bson_append_document(&opts, "sort", -1, &so);
            bson_destroy(&so);
        }
        int64_t limit = (q->limit >= 0) ? q->limit : MONGO_SCAN_CAP;
        bson_append_int64(&opts, "limit", -1, limit);
        if (q->skip >= 0) {
            bson_append_int64(&opts, "skip", -1, q->skip);
        }
        if (!attach_read_opts(c, &opts, &berr)) {
            mongo_stash_bson_error(c, "query failed", &berr);
            goto done;
        }
        cursor = mongoc_collection_find_with_opts(coll, filter, &opts, NULL);
    } else {
        /* aggregate: wrap the pipeline array so bson_new_from_json (which needs a
           top-level object) parses it; mongoc accepts the {pipeline:[...]} form. */
        filter = mongo_bson_wrap_relaxed("pipeline", q->filter, &berr);
        if (filter == NULL) {
            mongo_stash_bson_error(c, "invalid pipeline", &berr);
            goto done;
        }
        if (!attach_read_opts(c, &opts, &berr)) {
            mongo_stash_bson_error(c, "query failed", &berr);
            goto done;
        }
        cursor = mongoc_collection_aggregate(coll, MONGOC_QUERY_NONE, filter, &opts, NULL);
    }

    if (cursor == NULL) {
        mongo_set_err(c, "could not create cursor");
        goto done;
    }
    status = mongo_result_from_cursor(c, cursor, "query failed", out);

done:
    if (cursor != NULL) {
        mongoc_cursor_destroy(cursor);
    }
    bson_destroy(&opts);
    if (filter != NULL) {
        bson_destroy(filter);
    }
    if (coll != NULL) {
        mongoc_collection_destroy(coll);
    }
    return status;
}

dbc_status mongo_query_exec(dbc_conn *c, const char *sql, dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->client == NULL) {
        return DBC_ERR_PARAM;
    }
    if (c->db == NULL || c->db[0] == '\0') {
        mongo_set_err(c, "no database selected; set \"database\" in the connection");
        return DBC_ERR_QUERY;
    }

    mongo_query q;
    char perr[320];
    int prc = mongo_query_parse(sql, &q, perr, sizeof perr);
    if (prc != MONGO_PARSE_OK) {
        mongo_set_err(c, perr);
        return prc == MONGO_PARSE_UNSUPPORTED ? DBC_ERR_UNSUPPORTED : DBC_ERR_QUERY;
    }

    dbc_status status;
    if (q.op == MONGO_OP_FIND || q.op == MONGO_OP_AGGREGATE) {
        status = (q.explain != NULL) ? mongo_explain_exec(c, &q, out) : run_read(c, &q, out);
    } else {
        status = mongo_command_exec(c, &q, out);
    }
    mongo_query_free(&q);
    return status;
}
