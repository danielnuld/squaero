#include "internal.h"

/*
 * Informix driver entry point. Thin: it wires the vtable and exports
 * dbc_driver_entry. Behaviour lives in connection.c / query.c / metadata.c.
 *
 * Capabilities: connect + query + result-set (required) and introspection
 * (list_databases / list_tables / describe_table). Informix databases play the
 * role of the top tree level (owners are not exposed as a separate schema
 * layer), so list_schemas is NULL and DBC_FEAT_SCHEMAS is not advertised. DDL
 * generation, transactions and TLS are honestly absent for now (the matching
 * members are NULL and their flags are unset) and arrive in later tasks.
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

    .features      = DBC_FEAT_INTROSPECTION,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_informix_driver;
}
