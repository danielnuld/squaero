#include "internal.h"
#include "utils/types.h"

#include <stdlib.h>
#include <string.h>

/*
 * Query execution and result iteration. libpq buffers the whole result set
 * client-side (PQexec), so row iteration never fails mid-stream and the core can
 * read rows_affected for non-result statements without iterating. Multi-statement
 * scripts return the last statement's result, matching PQexec's own contract.
 */

/* Run a text statement; wrap a buffered result set, or record affected rows for
   a non-result statement (INSERT/UPDATE/DDL). The connection's error message is
   left in place for pg_drv_last_error on failure. */
static dbc_status run(dbc_conn *c, const char *sql, dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->conn == NULL) {
        return DBC_ERR_PARAM;
    }

    PGresult *res = PQexec(c->conn, sql);
    if (res == NULL) {
        return DBC_ERR_NOMEM;  /* OOM / connection lost; reason on c->conn */
    }

    ExecStatusType est = PQresultStatus(res);
    if (est == PGRES_TUPLES_OK || est == PGRES_SINGLE_TUPLE) {
        dbc_result *r = calloc(1, sizeof *r);
        if (r == NULL) {
            PQclear(res);
            return DBC_ERR_NOMEM;
        }
        r->res = res;
        r->nrows = PQntuples(res);
        r->ncols = PQnfields(res);
        r->row = -1;
        *out = r;
        return DBC_OK;
    }

    if (est == PGRES_COMMAND_OK || est == PGRES_EMPTY_QUERY) {
        dbc_result *r = calloc(1, sizeof *r);
        if (r == NULL) {
            PQclear(res);
            return DBC_ERR_NOMEM;
        }
        /* PQcmdTuples is the row count for INSERT/UPDATE/DELETE, "" otherwise. */
        const char *tuples = PQcmdTuples(res);
        r->affected = (tuples != NULL && tuples[0] != '\0') ? atoll(tuples) : 0;
        PQclear(res);  /* no rows to iterate; only `affected` is meaningful */
        *out = r;
        return DBC_OK;
    }

    /* PGRES_FATAL_ERROR / PGRES_BAD_RESPONSE / ... : the message is on c->conn. */
    PQclear(res);
    return DBC_ERR_QUERY;
}

dbc_status pg_drv_query(dbc_conn *c, const char *sql, dbc_result **out)
{
    return run(c, sql, out);
}

dbc_status pg_drv_run_stored(dbc_conn *c, const char *sql, dbc_result **out)
{
    return run(c, sql, out);
}

dbc_status pg_drv_make_synthetic(char *sql, dbc_result **out)
{
    *out = NULL;
    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        free(sql);
        return DBC_ERR_NOMEM;
    }
    r->synthetic = 1;
    r->synth_sql = sql;  /* ownership transferred; freed by free_result */
    *out = r;
    return DBC_OK;
}

void pg_drv_free_result(dbc_result *r)
{
    if (r == NULL) {
        return;
    }
    if (r->res != NULL) {
        PQclear(r->res);
    }
    free(r->synth_sql);
    free(r);
}

int pg_drv_col_count(dbc_result *r)
{
    if (r == NULL) {
        return 0;
    }
    if (r->synthetic) {
        return 1;
    }
    return r->res != NULL ? r->ncols : 0;
}

const char *pg_drv_col_name(dbc_result *r, int col)
{
    if (r == NULL) {
        return NULL;
    }
    if (r->synthetic) {
        return "sql";
    }
    if (r->res == NULL || col < 0 || col >= r->ncols) {
        return NULL;
    }
    return PQfname(r->res, col);
}

dbc_type pg_drv_col_type(dbc_result *r, int col)
{
    if (r == NULL) {
        return DBC_TYPE_NULL;
    }
    if (r->synthetic) {
        return DBC_TYPE_TEXT;
    }
    if (r->res == NULL || col < 0 || col >= r->ncols) {
        return DBC_TYPE_NULL;
    }
    return pg_oid_to_neutral((unsigned int)PQftype(r->res, col));
}

int pg_drv_next_row(dbc_result *r)
{
    if (r == NULL) {
        return 0;
    }
    if (r->synthetic) {
        if (r->synth_done) {
            return 0;
        }
        r->synth_done = 1;
        return r->synth_sql != NULL ? 1 : 0;
    }
    if (r->res == NULL) {
        return 0;
    }
    if (r->row + 1 < r->nrows) {
        r->row++;
        return 1;
    }
    r->row = r->nrows;  /* park at end so repeated calls keep returning 0 */
    return 0;
}

const char *pg_drv_cell_text(dbc_result *r, int col)
{
    if (r == NULL) {
        return NULL;
    }
    if (r->synthetic) {
        return col == 0 ? r->synth_sql : NULL;
    }
    if (r->res == NULL || col < 0 || col >= r->ncols ||
        r->row < 0 || r->row >= r->nrows) {
        return NULL;
    }
    if (PQgetisnull(r->res, r->row, col)) {
        return NULL;  /* SQL NULL */
    }
    return PQgetvalue(r->res, r->row, col);
}

long long pg_drv_rows_affected(dbc_result *r)
{
    return r != NULL ? r->affected : 0;
}

/* Run a transaction-control statement with no result set. On error the client's
   message is left on the connection for pg_drv_last_error. */
static dbc_status pg_drv_exec_control(dbc_conn *c, const char *sql)
{
    if (c == NULL || c->conn == NULL) {
        return DBC_ERR_PARAM;
    }
    PGresult *res = PQexec(c->conn, sql);
    if (res == NULL) {
        return DBC_ERR_NOMEM;
    }
    dbc_status st = (PQresultStatus(res) == PGRES_COMMAND_OK) ? DBC_OK
                                                              : DBC_ERR_QUERY;
    PQclear(res);
    return st;
}

dbc_status pg_drv_begin(dbc_conn *c)
{
    return pg_drv_exec_control(c, "BEGIN");
}

dbc_status pg_drv_commit(dbc_conn *c)
{
    return pg_drv_exec_control(c, "COMMIT");
}

dbc_status pg_drv_rollback(dbc_conn *c)
{
    return pg_drv_exec_control(c, "ROLLBACK");
}
