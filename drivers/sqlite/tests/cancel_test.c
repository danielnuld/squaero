#include "internal.h"  /* struct dbc_conn { sqlite3 *db; ... } — white-box access */

#include "dbcore/driver.h"

#include "sqlite3.h"

#include <stdio.h>
#include <string.h>

/*
 * Query cancellation through the vtable (DBC_FEAT_CANCEL). The contract checks
 * are self-evident; the interesting one is a REAL interruption proven without
 * threads: a SQLite progress handler fires mid-step and calls the driver's own
 * cancel hook (sqlite3_interrupt), so the running step returns SQLITE_INTERRUPT
 * and the driver surfaces it as an iteration error. This exercises exactly the
 * path a concurrent op.cancel drives, deterministically.
 */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static const dbc_driver_t *g_drv;
static int g_fired = 0;

/* Runs during sqlite3_step; cancels once, then lets the step observe the
   interrupt (returning 0 = "keep going", so the abort comes from the interrupt
   flag we just set, not from the progress handler itself). */
static int progress_cancel(void *p)
{
    g_fired++;
    g_drv->cancel((dbc_conn *)p);
    return 0;
}

int main(void)
{
    g_drv = dbc_driver_entry();

    /* Contract: the capability is advertised and the hook is wired. */
    EXPECT(g_drv->cancel != NULL, "cancel member is present");
    EXPECT((g_drv->features & DBC_FEAT_CANCEL) != 0, "DBC_FEAT_CANCEL advertised");
    EXPECT(g_drv->cancel(NULL) == DBC_ERR_UNSUPPORTED, "cancel(NULL) -> UNSUPPORTED");

    dbc_conn *c = NULL;
    EXPECT(g_drv->connect("{\"path\":\":memory:\"}", &c) == DBC_OK && c != NULL,
           "connect in-memory");

    /* Cancelling an idle connection is a harmless no-op. */
    EXPECT(g_drv->cancel(c) == DBC_OK, "cancel on a live idle conn -> OK");

    /* A long recursive CTE, interrupted from inside the step via the progress
       handler. The query prepares without stepping (a SELECT), so it returns OK;
       the first next_row starts stepping and trips the interrupt. */
    sqlite3_progress_handler(c->db, 50, progress_cancel, c);
    dbc_result *r = NULL;
    dbc_status st = g_drv->query(
        c,
        "WITH RECURSIVE seq(n) AS ("
        "  SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 100000000"
        ") SELECT n FROM seq",
        &r);
    EXPECT(st == DBC_OK && r != NULL, "long query prepares");

    int saw_error = 0;
    if (r != NULL) {
        for (;;) {
            int rc = g_drv->next_row(r);
            if (rc < 0) { saw_error = 1; break; }
            if (rc == 0) break;  /* finished without interrupt (unexpected) */
        }
        g_drv->free_result(r);
    }
    EXPECT(g_fired > 0, "progress handler fired");
    EXPECT(saw_error, "interrupted iteration reports an error");
    EXPECT(strstr(g_drv->last_error(c), "interrupt") != NULL,
           "last_error mentions the interrupt");

    sqlite3_progress_handler(c->db, 0, NULL, NULL);
    g_drv->disconnect(c);

    if (failures == 0) {
        printf("OK: sqlite cancel (contract + real interrupt)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
