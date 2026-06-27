#include "internal.h"

/*
 * SQLite driver entry point. Thin by design: it only wires the vtable and
 * exports dbc_driver_entry. All behaviour lives in connection.c / query.c.
 *
 * Capabilities: this reference driver implements the required connect + query +
 * result-set surface only. Introspection, transactions and DDL generation are
 * left NULL and unadvertised (features = 0); they arrive in later milestones,
 * at which point the matching DBC_FEAT_* flag is set.
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

    .features      = 0u,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_sqlite_driver;
}
