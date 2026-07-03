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
 * NULL and their flags unset). TLS is available through the connection URI but no
 * dedicated ssl_* configuration surface is exposed, so DBC_FEAT_SSL is not
 * advertised either.
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

    .features      = DBC_FEAT_INTROSPECTION,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_mongodb_driver;
}
