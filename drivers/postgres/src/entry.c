#include "internal.h"

/*
 * PostgreSQL driver entry point. Thin: it wires the vtable and exports
 * dbc_driver_entry. Behaviour lives in connection.c / query.c / metadata.c /
 * ddl.c / edit.c.
 *
 * Capabilities: connect + query + result-set (required), introspection
 * (list_databases / list_schemas / list_tables / describe_table), DDL
 * reconstruction (get_ddl) and single-row editing (build_dml). PostgreSQL has
 * real schemas within a database, so list_schemas is implemented and
 * DBC_FEAT_SCHEMAS is advertised. TLS is supported (DBC_FEAT_SSL) through the
 * libpq sslmode/ssl* DSN fields; the engine-agnostic SSH tunnel is handled in
 * the core. Transactions map to BEGIN/COMMIT/ROLLBACK. Query cancellation
 * (DBC_FEAT_CANCEL) uses libpq's thread-safe PQcancel.
 */
static const dbc_driver_t k_postgres_driver = {
    .abi_version   = DBC_ABI_VERSION,
    .name          = "postgres",
    .display_name  = "PostgreSQL",

    .connect       = pg_drv_connect,
    .disconnect    = pg_drv_disconnect,
    .last_error    = pg_drv_last_error,

    .query         = pg_drv_query,
    .free_result   = pg_drv_free_result,

    .col_count     = pg_drv_col_count,
    .col_name      = pg_drv_col_name,
    .col_type      = pg_drv_col_type,
    .next_row      = pg_drv_next_row,
    .cell_text     = pg_drv_cell_text,
    .rows_affected = pg_drv_rows_affected,

    .list_databases = pg_drv_list_databases,
    .list_schemas   = pg_drv_list_schemas,
    .list_tables    = pg_drv_list_tables,
    .describe_table = pg_drv_describe_table,

    .begin         = pg_drv_begin,
    .commit        = pg_drv_commit,
    .rollback      = pg_drv_rollback,

    .get_ddl       = pg_drv_get_ddl,

    .build_dml     = pg_drv_build_dml,

    .cancel        = pg_drv_cancel,

    .features      = DBC_FEAT_SSL | DBC_FEAT_SCHEMAS | DBC_FEAT_INTROSPECTION |
                     DBC_FEAT_DDL | DBC_FEAT_TRANSACTIONS | DBC_FEAT_DML |
                     DBC_FEAT_CANCEL,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_postgres_driver;
}
