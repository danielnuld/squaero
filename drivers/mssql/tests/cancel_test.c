#include "cancel.h"

#include <stdio.h>

/* Unit tests for the SQL Server cancel-request state machine (issue #668). */

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
    mssql_cancel c = {0};

    /* A fresh connection has nothing to act on. */
    EXPECT(!mssql_cancel_pending(&c), "zeroed -> not pending");
    EXPECT(!mssql_cancel_claim(&c), "zeroed -> nothing to claim");

    /* request -> pending -> claimed exactly once. */
    mssql_cancel_request(&c);
    EXPECT(mssql_cancel_pending(&c), "request -> pending");
    EXPECT(mssql_cancel_claim(&c), "first claim takes it");
    EXPECT(!mssql_cancel_pending(&c), "claimed -> no longer pending");
    EXPECT(!mssql_cancel_claim(&c), "second claim gets nothing");

    /* A second request while the first is being acted on is absorbed: one
       ATTENTION per query is enough. */
    mssql_cancel_request(&c);
    EXPECT(!mssql_cancel_pending(&c), "request after claim -> still sent");

    /* The next query starts clean. */
    mssql_cancel_reset(&c);
    EXPECT(!mssql_cancel_pending(&c), "reset -> not pending");
    EXPECT(!mssql_cancel_claim(&c), "reset -> nothing to claim");

    /* A request while idle is forgotten by the next query's reset (it must not
       cancel a query the user did not ask to cancel). */
    mssql_cancel_request(&c);
    mssql_cancel_request(&c);
    EXPECT(mssql_cancel_pending(&c), "repeated request -> pending");
    mssql_cancel_reset(&c);
    EXPECT(!mssql_cancel_pending(&c), "reset drops a stale request");

    if (failures == 0) {
        printf("OK: mssql cancel request (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
