#include "internal.h"
#include "utils/result.h"

/*
 * MongoDB driver entry point. Thin: it wires the vtable and exports
 * dbc_driver_entry. Behaviour lives in connection.c / query.c / metadata.c and
 * the pure helpers under utils/.
 *
 * Capabilities: connect + query (the mongosh surface: find/findOne/aggregate with
 * an optional trailing .explain(), the write commands insertOne/Many,
 * updateOne/Many, replaceOne, deleteOne/Many, and countDocuments, distinct,
 * createIndex/dropIndex/getIndexes, drop, renameCollection, createCollection,
 * createView, runCommand, and the server commands currentOp, killOp,
 * setProfilingLevel, getProfilingStatus, getCollectionInfos) + result-set reading
 * (required), introspection (list_databases / list_tables, which tells views from
 * collections / describe_table), data modification (DBC_FEAT_DML: build_dml
 * renders insertOne/updateOne/deleteOne keyed by `_id`, which describe_table
 * reports as the primary key) and DDL (DBC_FEAT_DDL: get_ddl returns a
 * collection's createCollection options + indexes as a reproducible mongosh
 * script). MongoDB has no schema layer between database and collection, so
 * list_schemas is NULL and DBC_FEAT_SCHEMAS is not advertised. TLS (DBC_FEAT_SSL)
 * is the DSN's `tls` field or a `uri` with tls=true; the server certificate is
 * verified against the system's trusted CAs. On Windows a URI's tlsCAFile is
 * refused, because the Secure Channel backend would install that CA machine-wide
 * (see connection.c).
 *
 * Transactions (DBC_FEAT_TRANSACTIONS) are multi-document transactions over a
 * mongoc client session (txn.c). The flag is static but the capability depends
 * on the server: begin checks the topology it is connected to and, on a
 * standalone mongod (or a secondary, or a server older than 4.0), fails with
 * DBC_ERR_UNSUPPORTED and the reason, never pretending. The frontend's edit
 * session reads that error and applies each change as it runs instead.
 *
 * Query cancellation (DBC_FEAT_CANCEL) works through killOp, because the
 * mongo-c-driver offers no way to interrupt an in-flight operation and a
 * mongoc_client_t may not be touched from a second thread while a query runs
 * (cancel.c). Every find/aggregate carries a per-connection tag as its `comment`;
 * cancel opens a SIDE client from the stored DSN, finds the operations carrying
 * the tag with $currentOp and kills them. It reads only immutable state of the
 * connection. It is best effort and says so: it covers find and aggregate (writes
 * and the utility commands run to completion), it needs the server to let the user
 * list and kill their own operations, and when it killed nothing the core reports
 * canceled:false. */
static const dbc_driver_t k_mongodb_driver = {
    .abi_version   = DBC_ABI_VERSION,
    .name          = "mongodb",
    .display_name  = "MongoDB",

    .connect       = mongo_connect,
    .disconnect    = mongo_disconnect,
    .last_error    = mongo_last_error,

    .query         = mongo_query_exec,
    .free_result   = mongo_free_result,

    .col_count     = mongo_col_count,
    .col_name      = mongo_col_name,
    .col_type      = mongo_col_type,
    .next_row      = mongo_next_row,
    .cell_text     = mongo_cell_text,
    .rows_affected = mongo_rows_affected,

    .list_databases = mongo_list_databases,
    /* .list_schemas intentionally NULL: MongoDB has no schema layer. */
    .list_tables    = mongo_list_tables,
    .describe_table = mongo_describe_table,

    .begin         = mongo_begin,
    .commit        = mongo_commit,
    .rollback      = mongo_rollback,

    .get_ddl       = mongo_get_ddl,
    .build_dml     = mongo_build_dml_result,
    .cancel        = mongo_cancel,

    .features      = DBC_FEAT_INTROSPECTION | DBC_FEAT_SSL | DBC_FEAT_TRANSACTIONS | DBC_FEAT_DDL |
                     DBC_FEAT_DML | DBC_FEAT_CANCEL,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_mongodb_driver;
}
