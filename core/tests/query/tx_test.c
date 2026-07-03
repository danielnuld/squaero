#include "dbcore/tx.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the transaction-control wrappers (dbcore_tx_*): they must call
   the vtable member when the driver advertises DBC_FEAT_TRANSACTIONS, refuse
   with DBC_ERR_UNSUPPORTED otherwise, and surface the driver's error text. */

struct dbc_conn { int tag; };

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static int g_begin, g_commit, g_rollback;

static dbc_status m_begin(dbc_conn *c)    { (void)c; g_begin++;    return DBC_OK; }
static dbc_status m_commit(dbc_conn *c)   { (void)c; g_commit++;   return DBC_OK; }
static dbc_status m_rollback(dbc_conn *c) { (void)c; g_rollback++; return DBC_OK; }
static dbc_status m_fail(dbc_conn *c)     { (void)c; return DBC_ERR_QUERY; }
static const char *m_last_error(dbc_conn *c) { (void)c; return "engine says no"; }

static dbc_driver_t base_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version = DBC_ABI_VERSION;
    d.name = "stub";
    d.display_name = "Stub";
    d.last_error = m_last_error;
    d.begin = m_begin;
    d.commit = m_commit;
    d.rollback = m_rollback;
    d.features = DBC_FEAT_TRANSACTIONS;
    return d;
}

int main(void)
{
    struct dbc_conn handle = { 42 };
    char err[128];

    /* Supported: each wrapper calls its member and returns OK. */
    {
        dbc_driver_t d = base_driver();
        dbcore_conn_ref ref = { &d, &handle };
        g_begin = g_commit = g_rollback = 0;
        err[0] = 'x';
        EXPECT(dbcore_tx_begin(&ref, err, sizeof err) == DBC_OK, "begin ok");
        EXPECT(dbcore_tx_commit(&ref, err, sizeof err) == DBC_OK, "commit ok");
        EXPECT(dbcore_tx_rollback(&ref, err, sizeof err) == DBC_OK, "rollback ok");
        EXPECT(g_begin == 1 && g_commit == 1 && g_rollback == 1, "each member called once");
        EXPECT(err[0] == '\0', "errbuf cleared on success");
    }

    /* Unsupported: flag absent -> UNSUPPORTED and the member is NOT called. */
    {
        dbc_driver_t d = base_driver();
        d.features = 0;
        dbcore_conn_ref ref = { &d, &handle };
        g_begin = 0;
        dbc_status st = dbcore_tx_begin(&ref, err, sizeof err);
        EXPECT(st == DBC_ERR_UNSUPPORTED, "no flag -> unsupported");
        EXPECT(g_begin == 0, "member not called when unsupported");
        EXPECT(strstr(err, "transaction") != NULL, "explains the reason");
    }

    /* Flag present but the member is NULL -> still UNSUPPORTED, not a crash. */
    {
        dbc_driver_t d = base_driver();
        d.commit = NULL;
        dbcore_conn_ref ref = { &d, &handle };
        EXPECT(dbcore_tx_commit(&ref, err, sizeof err) == DBC_ERR_UNSUPPORTED,
               "null member -> unsupported");
    }

    /* Member fails -> status propagates and the driver's message is surfaced. */
    {
        dbc_driver_t d = base_driver();
        d.begin = m_fail;
        dbcore_conn_ref ref = { &d, &handle };
        dbc_status st = dbcore_tx_begin(&ref, err, sizeof err);
        EXPECT(st == DBC_ERR_QUERY, "member failure propagates");
        EXPECT(strcmp(err, "engine says no") == 0, "driver error surfaced");
    }

    /* NULL connection is rejected as a parameter error. */
    EXPECT(dbcore_tx_begin(NULL, err, sizeof err) == DBC_ERR_PARAM, "NULL conn -> param");

    if (failures == 0) {
        printf("OK: transaction control wrappers (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
