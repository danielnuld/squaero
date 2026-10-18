#if !defined(_WIN32) && !defined(_POSIX_C_SOURCE)
#define _POSIX_C_SOURCE 200809L /* nanosleep */
#endif

#include "internal.h"
#include "utils/cancel_tag.h"

#include <stdlib.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <time.h>
#endif

/*
 * Query cancellation (DBC_FEAT_CANCEL): interrupt the read a connection is
 * running, from another thread.
 *
 * A mongoc_client_t may not be touched while an operation runs on it, and the
 * server offers no "cancel my query" -- only killOp by operation id. So every
 * find/aggregate carries the connection's cancel tag as its `comment`
 * (query.c; the tag is built once at connect and never changes), and cancel:
 *
 *   1. opens a short-lived SIDE client from the DSN stored at connect,
 *   2. lists the operations whose comment is the tag ($currentOp on admin),
 *   3. killOp's each, and closes the side client.
 *
 * It reads only c->dsn and c->cancel_tag (immutable after connect), never
 * c->client, c->session or c->err, so it is safe next to the running query. The
 * killed operation fails with "operation was interrupted", which the query path
 * reports as an ordinary query error.
 *
 * Limits, all honest: it needs the privilege to run $currentOp / killOp (the
 * caller's own operations need none on a server with access control; without
 * it cancel finds nothing and reports that it did not cancel); it covers
 * find and aggregate (writes and the utility commands carry no tag, so they run
 * to completion); and an operation the server has not registered yet is waited
 * for a short while (the race between the click and the server starting the
 * query).
 */

#define CANCEL_ATTEMPTS 5
#define CANCEL_RETRY_MS 150

static void sleep_ms(unsigned ms)
{
#ifdef _WIN32
    Sleep(ms);
#else
    struct timespec ts = {(time_t)(ms / 1000), (long)(ms % 1000) * 1000000L};
    nanosleep(&ts, NULL);
#endif
}

/* The operations tagged `tag`, via $currentOp on admin. Returns the reply's
   first-batch array in *reply (owned by the caller, only valid when true). */
static bool find_tagged(mongoc_client_t *side, const char *tag, bool all_users, bson_t *reply,
                        bson_error_t *berr)
{
    bson_t cmd = BSON_INITIALIZER, pipeline, stage, inner, match, ors, o0, o1, cursor;
    BSON_APPEND_INT32(&cmd, "aggregate", 1);
    BSON_APPEND_ARRAY_BEGIN(&cmd, "pipeline", &pipeline);
    BSON_APPEND_DOCUMENT_BEGIN(&pipeline, "0", &stage);
    BSON_APPEND_DOCUMENT_BEGIN(&stage, "$currentOp", &inner);
    BSON_APPEND_BOOL(&inner, "allUsers", all_users);
    bson_append_document_end(&stage, &inner);
    bson_append_document_end(&pipeline, &stage);
    /* A find / aggregate carries the comment in command; a getMore of its
       cursor in originatingCommand. */
    BSON_APPEND_DOCUMENT_BEGIN(&pipeline, "1", &stage);
    BSON_APPEND_DOCUMENT_BEGIN(&stage, "$match", &match);
    BSON_APPEND_ARRAY_BEGIN(&match, "$or", &ors);
    BSON_APPEND_DOCUMENT_BEGIN(&ors, "0", &o0);
    BSON_APPEND_UTF8(&o0, "command.comment", tag);
    bson_append_document_end(&ors, &o0);
    BSON_APPEND_DOCUMENT_BEGIN(&ors, "1", &o1);
    BSON_APPEND_UTF8(&o1, "originatingCommand.comment", tag);
    bson_append_document_end(&ors, &o1);
    bson_append_array_end(&match, &ors);
    bson_append_document_end(&stage, &match);
    bson_append_document_end(&pipeline, &stage);
    bson_append_array_end(&cmd, &pipeline);
    BSON_APPEND_DOCUMENT_BEGIN(&cmd, "cursor", &cursor);
    bson_append_document_end(&cmd, &cursor);

    bool ok = mongoc_client_command_with_opts(side, "admin", &cmd, NULL, NULL, reply, berr);
    bson_destroy(&cmd);
    return ok;
}

/* killOp for every tagged operation. Returns how many kill commands the server
   accepted, or -1 when the listing itself failed. */
static int kill_tagged(mongoc_client_t *side, const char *tag)
{
    bson_t reply;
    bson_error_t berr;
    /* All users first (needs the inprog privilege, or no access control); fall
       back to the caller's own operations, which any user may list. */
    if (!find_tagged(side, tag, true, &reply, &berr)) {
        bson_destroy(&reply);
        if (!find_tagged(side, tag, false, &reply, &berr)) {
            bson_destroy(&reply);
            return -1;
        }
    }

    int killed = 0;
    bson_iter_t cur, el, batch, doc;
    if (bson_iter_init_find(&cur, &reply, "cursor") && BSON_ITER_HOLDS_DOCUMENT(&cur) &&
        bson_iter_recurse(&cur, &el) && bson_iter_find(&el, "firstBatch") &&
        BSON_ITER_HOLDS_ARRAY(&el) && bson_iter_recurse(&el, &batch)) {
        while (bson_iter_next(&batch) && BSON_ITER_HOLDS_DOCUMENT(&batch)) {
            if (!bson_iter_recurse(&batch, &doc) || !bson_iter_find(&doc, "opid")) {
                continue;
            }
            bson_t kill = BSON_INITIALIZER, kreply;
            BSON_APPEND_INT32(&kill, "killOp", 1);
            bson_append_value(&kill, "op", -1, bson_iter_value(&doc));
            if (mongoc_client_command_with_opts(side, "admin", &kill, NULL, NULL, &kreply, &berr)) {
                killed++;
            }
            bson_destroy(&kreply);
            bson_destroy(&kill);
        }
    }
    bson_destroy(&reply);
    return killed;
}

dbc_status mongo_cancel(dbc_conn *c)
{
    if (c == NULL || c->dsn == NULL || !mongo_cancel_tag_is(c->cancel_tag)) {
        return DBC_ERR_UNSUPPORTED;
    }
    mongoc_client_t *side = mongo_side_client(c);
    if (side == NULL) {
        return DBC_ERR_UNSUPPORTED;
    }

    int killed = 0;
    for (int attempt = 0; attempt < CANCEL_ATTEMPTS; attempt++) {
        killed = kill_tagged(side, c->cancel_tag);
        if (killed != 0) {
            break; /* killed something, or the server refused the listing */
        }
        sleep_ms(CANCEL_RETRY_MS);
    }
    mongoc_client_destroy(side);

    /* DBC_OK only when an operation was actually killed; the core reports
       canceled:false otherwise (nothing running, or no privilege). */
    return killed > 0 ? DBC_OK : DBC_ERR_PARAM;
}
