#include "internal.h"
#include "utils/tx_support.h"

#include <string.h>

/*
 * Multi-document transactions over a mongoc client session.
 *
 * MongoDB has them only on a replica set (primary) or a sharded cluster, so the
 * driver advertises DBC_FEAT_TRANSACTIONS (the flag is static) and begin checks
 * the server it is actually connected to: on a standalone mongod it fails with
 * DBC_ERR_UNSUPPORTED and the reason, which is what the frontend's edit session
 * keys on to fall back to applying each change as it runs. Never a fake success.
 *
 * While a transaction is open, c->session is set and every operation the driver
 * runs (find/aggregate in query.c, the write and utility commands in command.c)
 * joins it by passing the session in its options. commit and rollback end the
 * session either way: after a failed commit the transaction is over (the server
 * aborts it or its outcome is unknown), so a later rollback has nothing to do and
 * reports so.
 */

static dbc_status fail(dbc_conn *c, dbc_status st, const char *ctx, const bson_error_t *berr)
{
    mongo_stash_bson_error(c, ctx, berr);
    return st;
}

static void end_session(dbc_conn *c)
{
    if (c->session != NULL) {
        mongoc_client_session_destroy(c->session);
        c->session = NULL;
    }
}

/* maxWireVersion of the server, or 0 when the hello reply does not say. */
static int max_wire_version(const mongoc_server_description_t *sd)
{
    bson_iter_t it;
    const bson_t *hello = mongoc_server_description_hello_response(sd);
    if (hello != NULL && bson_iter_init_find(&it, hello, "maxWireVersion") &&
        BSON_ITER_HOLDS_INT32(&it)) {
        return bson_iter_int32(&it);
    }
    return 0;
}

dbc_status mongo_begin(dbc_conn *c)
{
    if (c == NULL || c->client == NULL) {
        return DBC_ERR_PARAM;
    }
    if (c->session != NULL) {
        mongo_set_err(c, "a transaction is already open on this connection");
        return DBC_ERR_QUERY;
    }

    bson_error_t berr;
    mongoc_server_description_t *sd = mongoc_client_select_server(c->client, true, NULL, &berr);
    if (sd == NULL) {
        return fail(c, DBC_ERR_CONN, "could not reach the server to start a transaction", &berr);
    }
    mongo_tx_support support =
        mongo_tx_check(mongoc_server_description_type(sd), max_wire_version(sd));
    mongoc_server_description_destroy(sd);
    if (support != MONGO_TX_OK) {
        mongo_set_err(c, mongo_tx_message(support));
        return DBC_ERR_UNSUPPORTED;
    }

    mongoc_client_session_t *session = mongoc_client_start_session(c->client, NULL, &berr);
    if (session == NULL) {
        return fail(c, DBC_ERR_QUERY, "could not start a session", &berr);
    }
    if (!mongoc_client_session_start_transaction(session, NULL, &berr)) {
        mongoc_client_session_destroy(session);
        return fail(c, DBC_ERR_QUERY, "could not start the transaction", &berr);
    }
    c->session = session;
    return DBC_OK;
}

dbc_status mongo_commit(dbc_conn *c)
{
    if (c == NULL || c->client == NULL) {
        return DBC_ERR_PARAM;
    }
    if (c->session == NULL) {
        mongo_set_err(c, "no transaction in progress");
        return DBC_ERR_QUERY;
    }
    bson_error_t berr;
    bson_t reply;
    bool ok = mongoc_client_session_commit_transaction(c->session, &reply, &berr);
    bson_destroy(&reply);
    end_session(c);
    if (!ok) {
        return fail(c, DBC_ERR_QUERY, "commit failed", &berr);
    }
    return DBC_OK;
}

dbc_status mongo_rollback(dbc_conn *c)
{
    if (c == NULL || c->client == NULL) {
        return DBC_ERR_PARAM;
    }
    if (c->session == NULL) {
        mongo_set_err(c, "no transaction in progress");
        return DBC_ERR_QUERY;
    }
    bson_error_t berr;
    bool ok = mongoc_client_session_abort_transaction(c->session, &berr);
    end_session(c);
    if (!ok) {
        return fail(c, DBC_ERR_QUERY, "rollback failed", &berr);
    }
    return DBC_OK;
}
