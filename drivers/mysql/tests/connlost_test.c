#include "connlost.h"

#include <stdio.h>

/* Which MySQL error numbers mean "reconnect" and which mean "fix your SQL"
   (issue #407). Getting the second group wrong is the expensive direction: it
   would tell the user their connection dropped because they mistyped a column. */

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
    /* Client-side losses. */
    EXPECT(mysql_errno_is_conn_lost(2002u), "2002 connection error");
    EXPECT(mysql_errno_is_conn_lost(2003u), "2003 host error");
    EXPECT(mysql_errno_is_conn_lost(2006u), "2006 server gone away");
    EXPECT(mysql_errno_is_conn_lost(2013u), "2013 lost connection");
    EXPECT(mysql_errno_is_conn_lost(2055u), "2055 lost extended");

    /* The server hanging up on purpose. */
    EXPECT(mysql_errno_is_conn_lost(1053u), "1053 server shutdown");
    EXPECT(mysql_errno_is_conn_lost(1927u), "1927 connection killed");

    /* Ordinary query errors must NOT be reported as a lost connection. */
    EXPECT(!mysql_errno_is_conn_lost(1064u), "1064 syntax error is a query error");
    EXPECT(!mysql_errno_is_conn_lost(1146u), "1146 no such table is a query error");
    EXPECT(!mysql_errno_is_conn_lost(1062u), "1062 duplicate key is a query error");
    EXPECT(!mysql_errno_is_conn_lost(1045u), "1045 access denied is not a lost link");
    EXPECT(!mysql_errno_is_conn_lost(0u), "0 (no error) is not a lost connection");

    if (failures == 0) {
        printf("connlost_test: OK\n");
    }
    return failures == 0 ? 0 : 1;
}
