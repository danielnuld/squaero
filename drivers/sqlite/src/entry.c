#include "internal.h"

/*
 * SQLite driver entry point. Thin by design: it only wires the vtable and
 * exports dbc_driver_entry. All behaviour lives in connection.c / query.c.
 *
 * Capabilities: connect + query + result-set (required), plus introspection
 * (list_databases / list_tables / describe_table) and DDL generation (get_ddl).
 * SQLite has no schemas within a database, so list_schemas is left NULL and
 * DBC_FEAT_SCHEMAS is not advertised. Transactions arrive in a later milestone.
 */
static const dbc_driver_t k_sqlite_driver = {
    .abi_version   = DBC_ABI_VERSION,
    .name          = "sqlite",
    .display_name  = "SQLite",

    .connect       = sqlite_connect,
    .disconnect    = sqlite_disconnect,
    .last_error    = sqlite_last_error,

    .query         = sqlite_query,
    .free_result   = sqlite_free_result,

    .col_count     = sqlite_col_count,
    .col_name      = sqlite_col_name,
    .col_type      = sqlite_col_type,
    .next_row      = sqlite_next_row,
    .cell_text     = sqlite_cell_text,
    .rows_affected = sqlite_rows_affected,

    .list_databases = sqlite_list_databases,
    .list_tables    = sqlite_list_tables,
    .describe_table = sqlite_describe_table,

    .get_ddl       = sqlite_get_ddl,

    .features      = DBC_FEAT_INTROSPECTION | DBC_FEAT_DDL,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_sqlite_driver;
}
