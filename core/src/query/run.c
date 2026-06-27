#include "dbcore/query.h"

#include "materialize.h"

#include <stddef.h>

dbc_status dbcore_query_run(const dbcore_conn_ref *conn, const char *sql,
                            int max_rows, dbcore_result **out,
                            char *errbuf, size_t errcap)
{
    if (errbuf != NULL && errcap > 0) {
        errbuf[0] = '\0';
    }
    if (conn == NULL || conn->driver == NULL || conn->handle == NULL ||
        sql == NULL || out == NULL) {
        dbcore_copy_error(errbuf, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }
    *out = NULL;

    const dbc_driver_t *drv = conn->driver;

    dbc_result *dr = NULL;
    dbc_status st = drv->query(conn->handle, sql, &dr);
    if (st != DBC_OK) {
        dbcore_copy_error(errbuf, errcap, drv->last_error(conn->handle));
        if (dr != NULL) {
            drv->free_result(dr);
        }
        return st;
    }
    if (dr == NULL) {
        dbcore_copy_error(errbuf, errcap, "driver reported success but returned no result");
        return DBC_ERR_QUERY;
    }

    return dbcore_materialize(drv, conn->handle, dr, max_rows, out, errbuf, errcap);
}
