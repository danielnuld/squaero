#include "dbcore/edit.h"

#include "dbcore/query.h"
#include "dbcore/result.h"
#include "materialize.h"  /* dbcore_materialize, dbcore_copy_error */

#include <stdlib.h>
#include <string.h>

/* Owned copy of s, or NULL on OOM. */
static char *dup_cstr(const char *s)
{
    size_t n = strlen(s) + 1;
    char *p = malloc(n);
    if (p != NULL) {
        memcpy(p, s, n);
    }
    return p;
}

dbc_status dbcore_row_dml(const dbcore_conn_ref *conn, dbc_dml_kind kind,
                          const dbc_dml_row *row, int preview,
                          char **out_sql, long long *out_rows_affected,
                          char *errbuf, size_t errcap)
{
    if (errbuf != NULL && errcap > 0) {
        errbuf[0] = '\0';
    }
    if (out_sql != NULL) {
        *out_sql = NULL;
    }
    if (out_rows_affected != NULL) {
        *out_rows_affected = 0;
    }
    if (conn == NULL || conn->driver == NULL || conn->handle == NULL ||
        row == NULL || out_sql == NULL) {
        dbcore_copy_error(errbuf, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }

    const dbc_driver_t *drv = conn->driver;
    if (!(drv->features & DBC_FEAT_DML) || drv->build_dml == NULL) {
        dbcore_copy_error(errbuf, errcap,
                          "this engine does not support editing data");
        return DBC_ERR_UNSUPPORTED;
    }

    /* Ask the driver to render the change as a one-column ("sql") result. */
    dbc_result *dr = NULL;
    dbc_status st = drv->build_dml(conn->handle, kind, row, &dr);
    if (st != DBC_OK) {
        dbcore_copy_error(errbuf, errcap, drv->last_error(conn->handle));
        if (dr != NULL) {
            drv->free_result(dr);
        }
        return st;
    }
    if (dr == NULL) {
        dbcore_copy_error(errbuf, errcap, "driver returned no statement");
        return DBC_ERR_QUERY;
    }

    /* Materialize it (consumes dr) and read the single "sql" cell out. */
    dbcore_result *built = NULL;
    st = dbcore_materialize(drv, conn->handle, dr, 1, 0, &built, errbuf, errcap);
    if (st != DBC_OK) {
        return st;
    }
    const char *sql = (dbcore_result_row_count(built) >= 1 &&
                       dbcore_result_col_count(built) >= 1)
                          ? dbcore_result_cell(built, 0, 0)
                          : NULL;
    if (sql == NULL) {
        dbcore_result_free(built);
        dbcore_copy_error(errbuf, errcap, "driver produced no statement text");
        return DBC_ERR_QUERY;
    }
    char *sql_copy = dup_cstr(sql);
    dbcore_result_free(built);
    if (sql_copy == NULL) {
        dbcore_copy_error(errbuf, errcap, "out of memory");
        return DBC_ERR_NOMEM;
    }

    if (preview) {
        *out_sql = sql_copy;
        return DBC_OK;
    }

    /* Apply it through the normal query path. */
    dbcore_result *applied = NULL;
    st = dbcore_query_run(conn, sql_copy, 0, 0, &applied, errbuf, errcap);
    if (st != DBC_OK) {
        free(sql_copy);
        return st;
    }
    if (out_rows_affected != NULL) {
        *out_rows_affected = dbcore_result_rows_affected(applied);
    }
    dbcore_result_free(applied);
    *out_sql = sql_copy;
    return DBC_OK;
}
