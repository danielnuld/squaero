#include "internal.h"

/*
 * MySQL / MariaDB driver entry point. Thin: it wires the vtable and exports
 * dbc_driver_entry. Behaviour lives in connection.c / query.c / metadata.c /
 * ddl.c.
 *
 * Capabilities: connect + query + result-set (required), introspection
 * (list_databases / list_tables / describe_table) and DDL generation (get_ddl).
 * MySQL databases play the role of the top tree level (no separate schema
 * layer), so list_schemas is NULL and DBC_FEAT_SCHEMAS is not advertised.
 * Secure transport (SSL / SSH tunnel) and transactions arrive in later tasks.
 */
static const dbc_driver_t k_mysql_driver = {
    .abi_version   = DBC_ABI_VERSION,
    .name          = "mysql",
    .display_name  = "MySQL / MariaDB",

    .connect       = mysql_drv_connect,
    .disconnect    = mysql_drv_disconnect,
    .last_error    = mysql_drv_last_error,

    .query         = mysql_drv_query,
    .free_result   = mysql_drv_free_result,

    .col_count     = mysql_drv_col_count,
    .col_name      = mysql_drv_col_name,
    .col_type      = mysql_drv_col_type,
    .next_row      = mysql_drv_next_row,
    .cell_text     = mysql_drv_cell_text,
    .rows_affected = mysql_drv_rows_affected,

    .list_databases = mysql_drv_list_databases,
    /* .list_schemas intentionally NULL: MySQL databases are the top level. */
    .list_tables    = mysql_drv_list_tables,
    .describe_table = mysql_drv_describe_table,

    .get_ddl       = mysql_drv_get_ddl,

    .features      = DBC_FEAT_INTROSPECTION | DBC_FEAT_DDL,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_mysql_driver;
}
