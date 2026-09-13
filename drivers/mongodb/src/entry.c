#include "internal.h"
#include "utils/result.h"

/*
 * MongoDB driver entry point. Thin: it wires the vtable and exports
 * dbc_driver_entry. Behaviour lives in connection.c / query.c / metadata.c and
 * the pure helpers under utils/.
 *
 * Capabilities: connect + query (mongosh-style find/aggregate) + result-set
 * reading (required), and introspection (list_databases / list_tables /
 * describe_table). MongoDB has no schema layer between database and collection,
 * so list_schemas is NULL and DBC_FEAT_SCHEMAS is not advertised. DDL generation
 * and multi-document transactions are honestly absent for now (their members are
 * NULL and their flags unset). TLS (DBC_FEAT_SSL) is the DSN's `tls` field or a
 * `uri` with tls=true; the server certificate is verified against the system's
 * trusted CAs. On Windows a URI's tlsCAFile is refused, because the Secure
 * Channel backend would install that CA machine-wide (see connection.c).
 *
 * Query cancellation (DBC_FEAT_CANCEL) is intentionally NOT advertised. Unlike
 * SQLite (sqlite3_interrupt), MySQL (KILL QUERY) and Informix (SQLCancel), the
 * mongo-c-driver offers no thread-safe way to interrupt an in-flight operation:
 * a mongoc_client_t may not be touched from a second thread while a query runs,
 * and the only out-of-band mechanism (killOp) needs admin privileges plus racy
 * opid discovery. Rather than fake a cancel that usually cannot work, the driver
 * leaves .cancel NULL; the app still runs the query off the UI thread (so the
 * window stays responsive) and op.cancel honestly reports canceled:false.
 */
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

    .features      = DBC_FEAT_INTROSPECTION | DBC_FEAT_SSL,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_mongodb_driver;
}
