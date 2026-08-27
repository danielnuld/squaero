#include "connlost.h"

#include <stdio.h>

/* Which SQLSTATEs mean "reconnect" (issue #407). The rule is the CLASS, not a
   list of codes: class 08 is "connection exception" in the standard, so a code
   PostgreSQL adds later is classified correctly without touching this. */

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
    /* Class 08, whole class. */
    EXPECT(pg_sqlstate_is_conn_lost("08000"), "08000 connection exception");
    EXPECT(pg_sqlstate_is_conn_lost("08003"), "08003 connection does not exist");
    EXPECT(pg_sqlstate_is_conn_lost("08006"), "08006 connection failure");
    EXPECT(pg_sqlstate_is_conn_lost("08001"), "08001 unable to connect");
    EXPECT(pg_sqlstate_is_conn_lost("08P01"), "08P01 protocol violation");

    /* The server going away on purpose. */
    EXPECT(pg_sqlstate_is_conn_lost("57P01"), "57P01 admin shutdown");
    EXPECT(pg_sqlstate_is_conn_lost("57P02"), "57P02 crash shutdown");
    EXPECT(pg_sqlstate_is_conn_lost("57P03"), "57P03 cannot connect now");

    /* Ordinary failures stay query errors. */
    EXPECT(!pg_sqlstate_is_conn_lost("42601"), "42601 syntax error");
    EXPECT(!pg_sqlstate_is_conn_lost("42P01"), "42P01 undefined table");
    EXPECT(!pg_sqlstate_is_conn_lost("23505"), "23505 unique violation");
    EXPECT(!pg_sqlstate_is_conn_lost("28P01"), "28P01 bad password is not a lost link");
    EXPECT(!pg_sqlstate_is_conn_lost("57014"), "57014 query canceled is not a lost link");

    /* Nothing readable: stay a query error rather than guess. */
    EXPECT(!pg_sqlstate_is_conn_lost(NULL), "NULL sqlstate");
    EXPECT(!pg_sqlstate_is_conn_lost(""), "empty sqlstate");
    EXPECT(!pg_sqlstate_is_conn_lost("08"), "truncated sqlstate");

    if (failures == 0) {
        printf("connlost_test: OK\n");
    }
    return failures == 0 ? 0 : 1;
}
