/* Test fixture: a driver that exports a vtable with an incompatible ABI version.
   The loader must reject it with DBC_ERR_ABI. */
#include "dbcore/driver.h"

#include <stddef.h>

static dbc_status  f_connect(const char *d, dbc_conn **o) { (void)d; (void)o; return DBC_OK; }
static void        f_disconnect(dbc_conn *c) { (void)c; }
static const char *f_last_error(dbc_conn *c) { (void)c; return ""; }
static dbc_status  f_query(dbc_conn *c, const char *s, dbc_result **o) { (void)c; (void)s; (void)o; return DBC_OK; }
static void        f_free_result(dbc_result *r) { (void)r; }
static int         f_col_count(dbc_result *r) { (void)r; return 0; }
static const char *f_col_name(dbc_result *r, int c) { (void)r; (void)c; return ""; }
static dbc_type    f_col_type(dbc_result *r, int c) { (void)r; (void)c; return DBC_TYPE_NULL; }
static int         f_next_row(dbc_result *r) { (void)r; return 0; }
static const char *f_cell_text(dbc_result *r, int c) { (void)r; (void)c; return NULL; }
static long long   f_rows_affected(dbc_result *r) { (void)r; return 0; }

static const dbc_driver_t k_driver = {
    .abi_version   = DBC_ABI_VERSION + 1000,  /* deliberately incompatible */
    .name          = "fixture-bad-abi",
    .display_name  = "Bad ABI Fixture",
    .connect       = f_connect,
    .disconnect    = f_disconnect,
    .last_error    = f_last_error,
    .query         = f_query,
    .free_result   = f_free_result,
    .col_count     = f_col_count,
    .col_name      = f_col_name,
    .col_type      = f_col_type,
    .next_row      = f_next_row,
    .cell_text     = f_cell_text,
    .rows_affected = f_rows_affected,
    .features      = 0u,
};

DBC_DRIVER_EXPORT const dbc_driver_t *dbc_driver_entry(void)
{
    return &k_driver;
}
