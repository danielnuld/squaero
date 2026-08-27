#include "connlost.h"

#include <string.h>

int pg_sqlstate_is_conn_lost(const char *sqlstate)
{
    if (sqlstate == NULL || strlen(sqlstate) < 5) {
        return 0;
    }
    /* Class 08 — connection exception. */
    if (sqlstate[0] == '0' && sqlstate[1] == '8') {
        return 1;
    }
    /* Operator intervention: the server is going or gone. */
    if (strcmp(sqlstate, "57P01") == 0 || /* admin_shutdown */
        strcmp(sqlstate, "57P02") == 0 || /* crash_shutdown */
        strcmp(sqlstate, "57P03") == 0) { /* cannot_connect_now */
        return 1;
    }
    return 0;
}
