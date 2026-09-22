#include "dbcore/driver.h"

#include <stdio.h>

/*
 * Query cancellation wiring for the Informix driver (DBC_FEAT_CANCEL). Over DRDA
 * a cancel cuts the connection; that live behavior is covered by
 * tests/integration/informix_integration_test.c. Here we lock down the contract
 * a broken build would trip: the capability is advertised, the hook is present,
 * and it degrades cleanly when there is nothing to cancel (NULL conn, or a
 * connection that never connected). No server is required: a deliberately bad
 * DSN yields an error-state handle whose lock is nonetheless initialized.
 */

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
    const dbc_driver_t *drv = dbc_driver_entry();

    EXPECT(drv->cancel != NULL, "cancel member is present");
    EXPECT((drv->features & DBC_FEAT_CANCEL) != 0, "DBC_FEAT_CANCEL advertised");
    EXPECT(drv->cancel(NULL) == DBC_ERR_UNSUPPORTED, "cancel(NULL) -> UNSUPPORTED");

    /* A bad DSN fails to connect but still returns an error-state handle whose
       cancel lock is initialized; cancelling it (no statement running) is a
       clean PARAM, never a crash. */
    dbc_conn *c = NULL;
    drv->connect("{}", &c);
    EXPECT(c != NULL, "connect returns an error-state handle for a bad dsn");
    if (c != NULL) {
        EXPECT(drv->cancel(c) == DBC_ERR_PARAM, "cancel with nothing running -> PARAM");
        drv->disconnect(c);
    }

    if (failures == 0) {
        printf("OK: informix cancel (contract + idle behavior)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
