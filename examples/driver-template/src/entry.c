#include "internal.h"

/*
 * Example driver entry point. Thin by design: it only wires the vtable and
 * exports dbc_driver_entry under the name the loader looks up
 * (DBC_DRIVER_ENTRY_SYMBOL). All behaviour lives in driver.c.
 *
 * This template advertises NO optional capability (features = 0): the optional
 * members (introspection, transactions, DDL, DML) are left NULL. Honesty rule:
 * flip a DBC_FEAT_* bit only once a real handler backs it -- an advertised
 * capability with a NULL or faking handler is a bug.
 */
static const dbc_driver_t k_example_driver = {
    .abi_version   = DBC_ABI_VERSION,
    .name          = "example",
    .display_name  = "Example (template)",

    /* connection lifecycle (required) */
    .connect       = example_connect,
    .disconnect    = example_disconnect,
    .last_error    = example_last_error,

    /* execution (required) */
    .query         = example_query,
    .free_result   = example_free_result,

    /* result-set reading (required) */
    .col_count     = example_col_count,
    .col_name      = example_col_name,
    .col_type      = example_col_type,
    .next_row      = example_next_row,
    .cell_text     = example_cell_text,
    .rows_affected = example_rows_affected,

    /* no optional members, no features */
    .features      = 0,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_example_driver;
}
