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

/* --- query.c / command.c --- */
dbc_status  mongo_query_exec(dbc_conn *c, const char *sql, dbc_result **out);
/* Everything but find/aggregate: the write and utility commands. */
dbc_status  mongo_command_exec(dbc_conn *c, const mongo_query *q, dbc_result **out);

/* --- edit.c --- */
dbc_status  mongo_build_dml_result(dbc_conn *c, dbc_dml_kind kind,
                                   const dbc_dml_row *row, dbc_result **out);

/* --- metadata.c --- */
dbc_status  mongo_list_databases(dbc_conn *c, dbc_result **out);
dbc_status  mongo_list_tables(dbc_conn *c, const char *schema, dbc_result **out);
dbc_status  mongo_describe_table(dbc_conn *c, const char *schema,
                                 const char *table, dbc_result **out);

#endif /* QUAERO_MONGODB_INTERNAL_H */
