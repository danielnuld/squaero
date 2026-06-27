#include "dbcore/query.h"

#include "result_priv.h"

#include <stdlib.h>
#include <string.h>

static void copy_msg(char *errbuf, size_t errcap, const char *msg)
{
    if (errbuf == NULL || errcap == 0) {
        return;
    }
    if (msg == NULL) {
        msg = "unknown error";
    }
    size_t n = strlen(msg);
    if (n >= errcap) {
        n = errcap - 1;
    }
    memcpy(errbuf, msg, n);
    errbuf[n] = '\0';
}

dbc_status dbcore_query_run(const dbcore_conn_ref *conn, const char *sql,
                            int max_rows, dbcore_result **out,
                            char *errbuf, size_t errcap)
{
    if (errbuf != NULL && errcap > 0) {
        errbuf[0] = '\0';
    }
    if (conn == NULL || conn->driver == NULL || conn->handle == NULL ||
        sql == NULL || out == NULL) {
        copy_msg(errbuf, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }
    *out = NULL;

    const dbc_driver_t *drv = conn->driver;

    dbc_result *dr = NULL;
    dbc_status st = drv->query(conn->handle, sql, &dr);
    if (st != DBC_OK) {
        copy_msg(errbuf, errcap, drv->last_error(conn->handle));
        if (dr != NULL) {
            drv->free_result(dr);
        }
        return st;
    }
    if (dr == NULL) {
        copy_msg(errbuf, errcap, "driver reported success but returned no result");
        return DBC_ERR_QUERY;
    }

    int col_count = drv->col_count(dr);
    if (col_count < 0) {
        col_count = 0;
    }

    dbcore_result *res = dbcore_result_create(col_count);
    if (res == NULL) {
        drv->free_result(dr);
        copy_msg(errbuf, errcap, "out of memory");
        return DBC_ERR_NOMEM;
    }

    for (int c = 0; c < col_count; c++) {
        if (!dbcore_result_set_column(res, c, drv->col_name(dr, c),
                                      drv->col_type(dr, c))) {
            dbcore_result_free(res);
            drv->free_result(dr);
            copy_msg(errbuf, errcap, "out of memory");
            return DBC_ERR_NOMEM;
        }
    }
    dbcore_result_set_rows_affected(res, drv->rows_affected(dr));

    /* Only result-set statements have rows to iterate. */
    int rc = 0;
    if (col_count > 0) {
        const char **rowbuf = malloc((size_t)col_count * sizeof *rowbuf);
        if (rowbuf == NULL) {
            dbcore_result_free(res);
            drv->free_result(dr);
            copy_msg(errbuf, errcap, "out of memory");
            return DBC_ERR_NOMEM;
        }
        /* Fetch up to max_rows rows, then peek one more: if next_row still
           yields a row past the cap we report truncation accurately (the
           classic limit+1 technique). The peeked row is intentionally
           discarded — that one extra fetch is the cost of an honest flag. */
        while ((rc = drv->next_row(dr)) == 1) {
            if (max_rows > 0 && dbcore_result_row_count(res) >= max_rows) {
                dbcore_result_set_truncated(res, 1);
                break;
            }
            for (int c = 0; c < col_count; c++) {
                rowbuf[c] = drv->cell_text(dr, c);
            }
            if (!dbcore_result_add_row(res, rowbuf)) {
                free(rowbuf);
                dbcore_result_free(res);
                drv->free_result(dr);
                copy_msg(errbuf, errcap, "out of memory");
                return DBC_ERR_NOMEM;
            }
        }
        free(rowbuf);
    }

    if (rc < 0) {
        copy_msg(errbuf, errcap, drv->last_error(conn->handle));
        dbcore_result_free(res);
        drv->free_result(dr);
        return DBC_ERR_QUERY;
    }

    drv->free_result(dr);
    *out = res;
    return DBC_OK;
}
