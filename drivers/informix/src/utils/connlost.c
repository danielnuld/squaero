#include "connlost.h"

#include <string.h>

int ifx_sqlstate_is_conn_lost(const char *sqlstate)
{
    if (sqlstate == NULL || strlen(sqlstate) < 5) {
        return 0;
    }
    /* Class 08 — connection exception. 08S01 (communication link failure) is the
       one Informix reports when the session is gone; the rest of the class is
       the connect-time side of the same story. */
    return sqlstate[0] == '0' && sqlstate[1] == '8';
}
