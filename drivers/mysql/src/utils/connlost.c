#include "connlost.h"

int mysql_errno_is_conn_lost(unsigned int errnum)
{
    switch (errnum) {
    /* Client-side (CR_*): the connection could not be made or was lost. The
       numbers are hard-coded rather than taken from errmsg.h so this compiles
       the same against MySQL's client and MariaDB's Connector/C, which do not
       agree on which of these headers exists. */
    case 2002u: /* CR_CONNECTION_ERROR: local socket refused */
    case 2003u: /* CR_CONN_HOST_ERROR: TCP connect failed */
    case 2006u: /* CR_SERVER_GONE_ERROR: server closed it */
    case 2013u: /* CR_SERVER_LOST: lost while running the query */
    case 2055u: /* CR_SERVER_LOST_EXTENDED */
    /* Server-side: the other end hung up deliberately. */
    case 1053u: /* ER_SERVER_SHUTDOWN */
    case 1927u: /* ER_CONNECTION_KILLED: what a KILL does to its target */
        return 1;
    default:
        return 0;
    }
}
