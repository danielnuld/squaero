#include "internal.h"

/*
 * SQL Server driver entry point (issue #49). Thin: it wires the vtable and
 * exports dbc_driver_entry. Behaviour lives in connection.c / query.c /
 * metadata.c, over FreeTDS's db-lib.
 *
 * Capabilities: connect + query + result-set (required), introspection
 * (list_databases / list_schemas / list_tables / describe_table), transactions
 * (BEGIN/COMMIT/ROLLBACK TRANSACTION) and an encrypted transport (the DSN's
 * `encryption` field, DBC_FEAT_SSL). SQL Server has schemas within a database,
 * so DBC_FEAT_SCHEMAS is advertised.
 *
 * Cancellation (DBC_FEAT_CANCEL) on both clients. libtdswire sends the
 * ATTENTION from the calling thread. Over db-lib, whose dbcancel is not safe to
 * call from another thread while dbsqlexec runs, the cancel hook only raises a
 * flag and the query thread sends the ATTENTION (connection.c, issue #668).
 *
 * Honestly absent for now (members NULL, flags unset): DDL reconstruction and
 * single-row editing.
 */
static const dbc_driver_t k_mssql_driver = {
    .abi_version   = DBC_ABI_VERSION,
    .name          = "mssql",
    .display_name  = "SQL Server",

    .connect       = ms_drv_connect,
    .disconnect    = ms_drv_disconnect,
    .last_error    = ms_drv_last_error,

    .query         = ms_drv_query,
    .free_result   = ms_drv_free_result,

    .col_count     = ms_drv_col_count,
    .col_name      = ms_drv_col_name,
    .col_type      = ms_drv_col_type,
    .next_row      = ms_drv_next_row,
    .cell_text     = ms_drv_cell_text,
    .rows_affected = ms_drv_rows_affected,

    .list_databases = ms_drv_list_databases,
    .list_schemas   = ms_drv_list_schemas,
    .list_tables    = ms_drv_list_tables,
    .describe_table = ms_drv_describe_table,

    .begin         = ms_drv_begin,
    .commit        = ms_drv_commit,
    .rollback      = ms_drv_rollback,

    .cancel        = ms_drv_cancel,
    .features      = DBC_FEAT_SSL | DBC_FEAT_SCHEMAS | DBC_FEAT_INTROSPECTION |
                     DBC_FEAT_TRANSACTIONS | DBC_FEAT_CANCEL,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_mssql_driver;
}
