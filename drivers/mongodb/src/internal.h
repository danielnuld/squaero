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

/* --- query.c --- */
dbc_status  mongo_query_exec(dbc_conn *c, const char *sql, dbc_result **out);

/* --- metadata.c --- */
dbc_status  mongo_list_databases(dbc_conn *c, dbc_result **out);
dbc_status  mongo_list_tables(dbc_conn *c, const char *schema, dbc_result **out);
dbc_status  mongo_describe_table(dbc_conn *c, const char *schema,
                                 const char *table, dbc_result **out);

#endif /* QUAERO_MONGODB_INTERNAL_H */
