#include "dbcore/op_registry.h"

#include <stdio.h>

/* The core holds dbc_conn opaquely; the test supplies a concrete shape, exactly
   as the driver would. Only its address matters here (it is passed to cancel). */
struct dbc_conn { int tag; };

static int failures = 0;
#define EXPECT(cond, msg)                              \
    do {                                               \
        if (!(cond)) {                                 \
            fprintf(stderr, "FAIL: %s\n", (msg));      \
            failures++;                                \
        }                                              \
    } while (0)

static int       g_cancel_calls  = 0;
static dbc_conn *g_last_canceled = NULL;

static dbc_status stub_cancel(dbc_conn *c)
{
    g_cancel_calls++;
    g_last_canceled = c;
    return DBC_OK;
}

/* A driver that advertises and implements cancel. */
static dbc_driver_t cancel_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version = DBC_ABI_VERSION;
    d.name        = "cancelable";
    d.cancel      = stub_cancel;
    d.features    = DBC_FEAT_CANCEL;
    return d;
}

/* A driver with no cancel support at all. */
static dbc_driver_t plain_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version = DBC_ABI_VERSION;
    d.name        = "plain";
    return d;
}

int main(void)
{
    dbc_driver_t   cdrv  = cancel_driver();
    dbc_driver_t   pdrv  = plain_driver();
    struct dbc_conn conn1 = { 1 };
    struct dbc_conn conn2 = { 2 };

    dbcore_op_registry_reset();

    /* Idle: nothing to cancel. */
    EXPECT(dbcore_op_cancel(1) == DBC_ERR_PARAM, "cancel while idle -> PARAM");
    EXPECT(g_cancel_calls == 0, "no cancel delivered while idle");

    /* A running query can be canceled, reaching the right handle. */
    dbcore_op_begin(1, &cdrv, &conn1);
    EXPECT(dbcore_op_cancel(1) == DBC_OK, "cancel a running query -> OK");
    EXPECT(g_cancel_calls == 1, "driver cancel invoked once");
    EXPECT(g_last_canceled == &conn1, "cancel reached the right handle");

    /* After end, the entry is gone. */
    dbcore_op_end(1);
    EXPECT(dbcore_op_cancel(1) == DBC_ERR_PARAM, "cancel after end -> PARAM");
    EXPECT(g_cancel_calls == 1, "no extra cancel after end");

    /* A driver that cannot cancel reports UNSUPPORTED without inventing success. */
    dbcore_op_begin(2, &pdrv, &conn2);
    EXPECT(dbcore_op_cancel(2) == DBC_ERR_UNSUPPORTED, "no-cancel driver -> UNSUPPORTED");
    EXPECT(g_cancel_calls == 1, "unsupported driver delivers no cancel");
    dbcore_op_end(2);

    /* Re-registering the same conn id (a fresh run) uses the latest handle. */
    dbcore_op_begin(1, &cdrv, &conn1);
    dbcore_op_begin(1, &cdrv, &conn2);
    EXPECT(dbcore_op_cancel(1) == DBC_OK, "re-registered conn cancels");
    EXPECT(g_last_canceled == &conn2, "cancel uses the latest handle");
    dbcore_op_end(1);

    /* Distinct conns are independent. */
    dbcore_op_begin(7, &cdrv, &conn1);
    EXPECT(dbcore_op_cancel(8) == DBC_ERR_PARAM, "unrelated conn id -> PARAM");
    EXPECT(dbcore_op_cancel(7) == DBC_OK, "the registered conn still cancels");
    dbcore_op_end(7);

    dbcore_op_registry_reset();

    if (failures == 0) {
        printf("OK: op registry (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
