#include "dbcore/query.h"

#include "materialize.h"

#include <stddef.h>

dbc_status dbcore_query_run(const dbcore_conn_ref *conn, const char *sql,
                            int max_rows, int offset, dbcore_result **out,
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

    return dbcore_materialize(drv, conn->handle, dr, max_rows, offset, out, errbuf, errcap);
}

dbc_status dbcore_query_open(const dbcore_conn_ref *conn, const char *sql,
                             int max_rows, dbcore_result **out,
                             dbc_result **out_cursor, char *errbuf, size_t errcap)
{
    if (out_cursor != NULL) {
        *out_cursor = NULL;
    }
    if (errbuf != NULL && errcap > 0) {
        errbuf[0] = '\0';
    }
    if (conn == NULL || conn->driver == NULL || conn->handle == NULL ||
        sql == NULL || out == NULL || out_cursor == NULL) {
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

    st = dbcore_materialize_page(drv, conn->handle, dr, max_rows, out, errbuf, errcap);
    /* The result survives only while there is more to read; materialize_page
       freed it otherwise (and on failure). */
    if (st == DBC_OK && dbcore_result_truncated(*out)) {
        *out_cursor = dr;
    }
    return st;
}

dbc_status dbcore_query_next(const dbcore_conn_ref *conn, dbc_result *cursor,
                             int max_rows, dbcore_result **out, int *out_open,
                             char *errbuf, size_t errcap)
{
    if (out_open != NULL) {
        *out_open = 0;
    }
    if (errbuf != NULL && errcap > 0) {
        errbuf[0] = '\0';
    }
    if (conn == NULL || conn->driver == NULL || conn->handle == NULL ||
        cursor == NULL || out == NULL || out_open == NULL) {
        dbcore_copy_error(errbuf, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }
    *out = NULL;

    dbc_status st = dbcore_materialize_page(conn->driver, conn->handle, cursor,
                                            max_rows, out, errbuf, errcap);
    if (st == DBC_OK && dbcore_result_truncated(*out)) {
        *out_open = 1;
    }
    return st;
}
