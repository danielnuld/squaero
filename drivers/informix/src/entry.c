#include "internal.h"

/*
 * Informix driver entry point. Thin: it wires the vtable and exports
 * dbc_driver_entry. Behaviour lives in connection.c / query.c / metadata.c.
 *
 * Capabilities: connect + query + result-set (required), introspection
 * (list_databases / list_tables / describe_table), transactions (begin/commit/
 * rollback via ODBC autocommit + SQLEndTran) and single-row data modification
 * (build_dml), DDL reconstruction (get_ddl, synthesized from the catalogs) and
 * query cancellation (cancel, via ODBC SQLCancel on a side thread). Informix
 * databases play the role of the top tree level (owners are not exposed as a
 * separate schema layer), so list_schemas is NULL and DBC_FEAT_SCHEMAS is not
 * advertised. TLS is honestly absent for now (its flag is unset).
 */
static const dbc_driver_t k_informix_driver = {
    .abi_version   = DBC_ABI_VERSION,
    .name          = "informix",
    .display_name  = "IBM Informix",

    .connect       = ifx_connect,
    .disconnect    = ifx_disconnect,
    .last_error    = ifx_last_error,

    .query         = ifx_query,
    .free_result   = ifx_free_result,

    .col_count     = ifx_col_count,
    .col_name      = ifx_col_name,
    .col_type      = ifx_col_type,
    .next_row      = ifx_next_row,
    .cell_text     = ifx_cell_text,
    .rows_affected = ifx_rows_affected,

    .list_databases = ifx_list_databases,
    /* .list_schemas intentionally NULL: Informix databases are the top level. */
    .list_tables    = ifx_list_tables,
    .describe_table = ifx_describe_table,

    .begin         = ifx_begin,
    .commit        = ifx_commit,
    .rollback      = ifx_rollback,

    .get_ddl       = ifx_get_ddl,

    .build_dml     = ifx_build_dml,

    .cancel        = ifx_cancel,

    .features      = DBC_FEAT_INTROSPECTION | DBC_FEAT_DDL | DBC_FEAT_TRANSACTIONS |
                     DBC_FEAT_DML | DBC_FEAT_CANCEL,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_informix_driver;
}
