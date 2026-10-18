#ifndef QUAERO_MONGODB_INTERNAL_H
#define QUAERO_MONGODB_INTERNAL_H

/*
 * Internal definitions shared across the MongoDB driver translation units that
 * talk to the mongo-c-driver. The only public symbol is dbc_driver_entry. The
 * pure helpers under utils/ (bson type mapping, flatten column accumulator,
 * mongosh query parser, result builder, datetime formatter) never include this
 * header — they depend only on driver.h — so they stay compilable and testable
 * without a MongoDB client installed. Vtable functions carry a `mongo_` prefix.
 */

#include "dbcore/driver.h"

#include <mongoc/mongoc.h>

/* After mongoc.h: its bson-compat.h must see the C library headers first-hand
   on MinGW (__USE_MINGW_ANSI_STDIO). */
#include "utils/query_parse.h"

/* A live connection: an initialized mongoc client plus the default database the
   connection is bound to (queries and unqualified introspection run against it).
   `err` holds the last error text; last_error never returns NULL. */
struct dbc_conn {
    mongoc_client_t *client;
    char            *db;        /* default database name (owned) */
    char             err[1024];
    /* The open multi-document transaction's session, or NULL (txn.c). Touched
       only by the thread running the connection's operations. */
    mongoc_client_session_t *session;
    /* Set once at connect and never written again, so cancel (which runs on
       another thread while a query is in flight) may read them without a lock:
       the DSN to open a side client with, and the tag every read carries as its
       `comment` for cancel to find it by (cancel.c, utils/cancel_tag.c). */
    char            *dsn;
    char             cancel_tag[64];
};

/* Safety cap on how many documents an unbounded find buffers, so a query with
   no explicit .limit() cannot exhaust memory on a huge collection. Chosen well
   above the core's default row cap (1000) so the core's truncation flag still
   fires accurately for the common case. */
#define MONGO_SCAN_CAP 10000

/* Documents sampled by describe_table to infer a collection's fields. */
#define MONGO_DESCRIBE_SAMPLE 200

/* --- connection.c --- */
dbc_status  mongo_connect(const char *dsn_json, dbc_conn **out);
void        mongo_disconnect(dbc_conn *c);
const char *mongo_last_error(dbc_conn *c);
/* Set a plain driver-side error reason on the connection (shared). */
void        mongo_set_err(dbc_conn *c, const char *msg);
/* Copy a bson_error_t message onto the connection, prefixed with ctx (shared). */
void        mongo_stash_bson_error(dbc_conn *c, const char *ctx,
                                   const bson_error_t *error);

/* --- docs.c: BSON <-> neutral result plumbing (shared by query/command/ddl) --- */

/* Parse a mongosh-style (relaxed) JSON document into a new bson_t: bare keys,
   single quotes and ObjectId("..")/ISODate("..")/NumberLong(..) constructors are
   normalized to strict Extended JSON first. NULL on a parse error (err filled). */
bson_t     *mongo_bson_from_relaxed(const char *text, bson_error_t *err);
/* As above, initializing a caller-provided bson_t. Returns 1 on success. */
int         mongo_bson_init_relaxed(bson_t *out, const char *text, bson_error_t *err);
/* Parse `value_text` (any relaxed JSON value, e.g. an array) as the value of
   `key` in a new one-field document {key: value}. */
bson_t     *mongo_bson_wrap_relaxed(const char *key, const char *value_text,
                                    bson_error_t *err);

/* Relaxed Extended JSON of an array (`[ 1, 2 ]`), as a malloc'd string, or NULL. */
char       *mongo_bson_array_json(const bson_t *arr);

/* Render the value at `iter` as neutral cell text (see docs/MONGODB.md). */
char       *mongo_bson_cell_text(const bson_iter_t *iter, dbc_type *type, int *is_null);

/* Flatten documents into a tabular result (union of top-level fields as columns,
   `_id` first, a missing field NULL). The documents stay owned by the caller. */
dbc_status  mongo_result_from_docs(dbc_conn *c, bson_t *const *docs, int ndocs,
                                   dbc_result **out);
/* Drain (up to MONGO_SCAN_CAP documents of) a cursor into a flattened result. */
dbc_status  mongo_result_from_cursor(dbc_conn *c, mongoc_cursor_t *cursor,
                                     const char *err_ctx, dbc_result **out);
/* A one-column, one-row text result (get_ddl / build_dml: column "sql"). */
dbc_status  mongo_text_result(dbc_conn *c, const char *column, const char *text,
                              dbc_result **out);

/* A fresh client built from the DSN stored at connect, with short timeouts, for
   the cancel side channel. Uses no state of `c` but the immutable `dsn`. NULL on
   failure. */
mongoc_client_t *mongo_side_client(const dbc_conn *c);

/* --- query.c / command.c --- */
dbc_status  mongo_query_exec(dbc_conn *c, const char *sql, dbc_result **out);
/* Everything but find/aggregate: the write and utility commands. */
dbc_status  mongo_command_exec(dbc_conn *c, const mongo_query *q, dbc_result **out);

/* Helpers shared by the command implementations (command.c). */
dbc_status  mongo_fail_bson(dbc_conn *c, const char *ctx, const bson_error_t *berr);
dbc_status  mongo_fail_msg(dbc_conn *c, dbc_status st, const char *msg);
long long   mongo_reply_int(const bson_t *reply, const char *key);
/* Copy a reply's useful fields into `ack` (session / cluster-time plumbing is
   dropped; `ok` only when keep_ok). */
void        mongo_append_reply(bson_t *ack, const bson_t *reply, int keep_ok);
/* Flatten `ack` (one row) and stamp rows_affected. */
dbc_status  mongo_finish_ack(dbc_conn *c, bson_t *ack, long long affected, dbc_result **out);
/* The optional options document at q->args[idx] (*opts stays NULL when absent). */
dbc_status  mongo_parse_opts(dbc_conn *c, const mongo_query *q, int idx, bson_t **opts);
/* Add the open transaction's session to *opts (created when NULL); a no-op
   outside a transaction. Error status with the message stored on failure. */
dbc_status  mongo_attach_session(dbc_conn *c, bson_t **opts);
/* Run `cmd` on database `dbname`, outside any transaction, and flatten the reply
   (minus the plumbing) into a one-row result. */
dbc_status  mongo_run_admin_command(dbc_conn *c, const char *dbname, const bson_t *cmd,
                                    const char *ctx, dbc_result **out);

/* --- admin.c: plans, operations, profiler, rename, collection infos --- */
dbc_status  mongo_admin_exec(dbc_conn *c, const mongo_query *q, dbc_result **out);
/* find / aggregate with a trailing .explain(): the server's plan as a result. */
dbc_status  mongo_explain_exec(dbc_conn *c, const mongo_query *q, dbc_result **out);

/* --- txn.c: multi-document transactions (replica set / sharded only) --- */
dbc_status  mongo_begin(dbc_conn *c);
dbc_status  mongo_commit(dbc_conn *c);
dbc_status  mongo_rollback(dbc_conn *c);

/* --- cancel.c: killOp from a side client (thread-safe) --- */
dbc_status  mongo_cancel(dbc_conn *c);

/* --- ddl.c / edit.c --- */
dbc_status  mongo_get_ddl(dbc_conn *c, const char *schema, const char *object,
                          dbc_result **out);
dbc_status  mongo_build_dml_result(dbc_conn *c, dbc_dml_kind kind,
                                   const dbc_dml_row *row, dbc_result **out);

/* --- metadata.c --- */
dbc_status  mongo_list_databases(dbc_conn *c, dbc_result **out);
dbc_status  mongo_list_tables(dbc_conn *c, const char *schema, dbc_result **out);
dbc_status  mongo_describe_table(dbc_conn *c, const char *schema,
                                 const char *table, dbc_result **out);

#endif /* QUAERO_MONGODB_INTERNAL_H */
