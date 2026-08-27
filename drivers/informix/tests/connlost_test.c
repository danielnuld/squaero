#include "connlost.h"

#include <stdio.h>

/* Which ODBC SQLSTATEs mean "reconnect" (issue #407) — the engine the report was
   about. The rule is the class, so a code the CSDK reports that we never saw is
   still classified correctly. */

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
    /* Class 08 — connection exception. */
    EXPECT(ifx_sqlstate_is_conn_lost("08S01"), "08S01 communication link failure");
    EXPECT(ifx_sqlstate_is_conn_lost("08003"), "08003 connection not open");
    EXPECT(ifx_sqlstate_is_conn_lost("08001"), "08001 unable to connect");
    EXPECT(ifx_sqlstate_is_conn_lost("08004"), "08004 server rejected");
    EXPECT(ifx_sqlstate_is_conn_lost("08007"), "08007 transaction state unknown");

    /* Ordinary failures stay query errors. */
    EXPECT(!ifx_sqlstate_is_conn_lost("42000"), "42000 syntax error");
    EXPECT(!ifx_sqlstate_is_conn_lost("42S02"), "42S02 table not found");
    EXPECT(!ifx_sqlstate_is_conn_lost("23000"), "23000 constraint violation");
    EXPECT(!ifx_sqlstate_is_conn_lost("28000"), "28000 bad authorization");
    EXPECT(!ifx_sqlstate_is_conn_lost("HY000"), "HY000 general error");
    EXPECT(!ifx_sqlstate_is_conn_lost("HYT00"), "HYT00 timeout expired");
    EXPECT(!ifx_sqlstate_is_conn_lost("00000"), "00000 success");

    /* Nothing readable: stay a query error. */
    EXPECT(!ifx_sqlstate_is_conn_lost(NULL), "NULL sqlstate");
    EXPECT(!ifx_sqlstate_is_conn_lost(""), "empty sqlstate");
    EXPECT(!ifx_sqlstate_is_conn_lost("08"), "truncated sqlstate");

    if (failures == 0) {
        printf("connlost_test: OK\n");
    }
    return failures == 0 ? 0 : 1;
}
