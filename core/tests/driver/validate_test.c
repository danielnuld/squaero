#include "dbcore/driver.h"

#include <stdio.h>

/*
 * Tests for dbc_driver_validate: the load-time ABI/required-member gate.
 * Covers nominal, NULL, ABI mismatch, and each class of missing required member.
 */

/* --- stub vtable members (never called; only their presence is checked) --- */
static dbc_status  stub_connect(const char *d, dbc_conn **o) { (void)d; (void)o; return DBC_OK; }
static void        stub_disconnect(dbc_conn *c) { (void)c; }
static const char *stub_last_error(dbc_conn *c) { (void)c; return ""; }
static dbc_status  stub_query(dbc_conn *c, const char *s, dbc_result **o) { (void)c; (void)s; (void)o; return DBC_OK; }
static void        stub_free_result(dbc_result *r) { (void)r; }
static int         stub_col_count(dbc_result *r) { (void)r; return 0; }
static const char *stub_col_name(dbc_result *r, int c) { (void)r; (void)c; return ""; }
static dbc_type    stub_col_type(dbc_result *r, int c) { (void)r; (void)c; return DBC_TYPE_NULL; }
static int         stub_next_row(dbc_result *r) { (void)r; return 0; }
static const char *stub_cell_text(dbc_result *r, int c) { (void)r; (void)c; return NULL; }
static long long   stub_rows_affected(dbc_result *r) { (void)r; return 0; }

/* A fully-populated, valid driver vtable. */
static dbc_driver_t make_valid_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version   = DBC_ABI_VERSION;
    d.name          = "stub";
    d.display_name  = "Stub";
    d.connect       = stub_connect;
    d.disconnect    = stub_disconnect;
    d.last_error    = stub_last_error;
    d.query         = stub_query;
    d.free_result   = stub_free_result;
    d.col_count     = stub_col_count;
    d.col_name      = stub_col_name;
    d.col_type      = stub_col_type;
    d.next_row      = stub_next_row;
    d.cell_text     = stub_cell_text;
    d.rows_affected = stub_rows_affected;
    d.features      = 0u;
    return d;
}

static int failures = 0;

#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

int main(void)
{
    /* Nominal: a complete vtable validates. */
    {
        dbc_driver_t d = make_valid_driver();
        EXPECT(dbc_driver_validate(&d) == DBC_OK, "valid driver should be DBC_OK");
    }

    /* NULL pointer. */
    EXPECT(dbc_driver_validate(NULL) == DBC_ERR_PARAM, "NULL driver should be DBC_ERR_PARAM");

    /* ABI mismatch (both directions). */
    {
        dbc_driver_t d = make_valid_driver();
        d.abi_version = DBC_ABI_VERSION + 1;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_ABI, "newer ABI should be DBC_ERR_ABI");
        d.abi_version = 0;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_ABI, "ABI 0 should be DBC_ERR_ABI");
    }

    /* Missing identity strings. */
    {
        dbc_driver_t d = make_valid_driver();
        d.name = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_UNSUPPORTED, "NULL name should be DBC_ERR_UNSUPPORTED");
    }
    {
        dbc_driver_t d = make_valid_driver();
        d.display_name = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_UNSUPPORTED, "NULL display_name should be DBC_ERR_UNSUPPORTED");
    }

    /* Missing lifecycle members. */
    {
        dbc_driver_t d = make_valid_driver();
        d.connect = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_UNSUPPORTED, "NULL connect should be DBC_ERR_UNSUPPORTED");
    }
    {
        dbc_driver_t d = make_valid_driver();
        d.disconnect = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_UNSUPPORTED, "NULL disconnect should be DBC_ERR_UNSUPPORTED");
    }
    {
        dbc_driver_t d = make_valid_driver();
        d.last_error = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_UNSUPPORTED, "NULL last_error should be DBC_ERR_UNSUPPORTED");
    }

    /* Missing execution members. */
    {
        dbc_driver_t d = make_valid_driver();
        d.query = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_UNSUPPORTED, "NULL query should be DBC_ERR_UNSUPPORTED");
    }
    {
        dbc_driver_t d = make_valid_driver();
        d.free_result = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_UNSUPPORTED, "NULL free_result should be DBC_ERR_UNSUPPORTED");
    }

    /* Missing result-set readers. */
    {
        dbc_driver_t d = make_valid_driver();
        d.col_count = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_UNSUPPORTED, "NULL col_count should be DBC_ERR_UNSUPPORTED");
    }
    {
        dbc_driver_t d = make_valid_driver();
        d.cell_text = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_ERR_UNSUPPORTED, "NULL cell_text should be DBC_ERR_UNSUPPORTED");
    }

    /* Optional members may be NULL: a driver advertising no extra features and
       leaving introspection/transaction members unset is still valid. */
    {
        dbc_driver_t d = make_valid_driver();
        d.list_databases = NULL;
        d.begin = NULL;
        EXPECT(dbc_driver_validate(&d) == DBC_OK, "absent optional members should still be DBC_OK");
    }

    if (failures == 0) {
        printf("OK: dbc_driver_validate (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
