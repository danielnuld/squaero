#include "internal.h"
#include "utils/odbc_types.h"

#include <stdlib.h>
#include <string.h>

/*
 * Query execution and result iteration over ODBC. SQLExecDirect runs the text
 * statement; column metadata is described once and cached. Each row is pulled
 * cell-by-cell with SQLGetData(SQL_C_CHAR) into per-column buffers that grow to
 * fit long values, so the neutral cell_text contract (a stable pointer per cell
 * until the next fetch) is honored and SQL NULL is distinguished from empty via
 * the indicator. A statement that returns no columns (INSERT/UPDATE/DDL) keeps
 * only its affected-row count.
 */

#define IFX_CELL_INIT_CAP 256

static void free_result_arrays(dbc_result *r)
{
    if (r->col_names != NULL) {
        for (int i = 0; i < r->ncols; i++) {
            free(r->col_names[i]);
        }
        free(r->col_names);
    }
    if (r->cell != NULL) {
        for (int i = 0; i < r->ncols; i++) {
            free(r->cell[i]);
        }
        free(r->cell);
    }
    free(r->col_types);
    free(r->cell_cap);
    free(r->cell_null);
}

/* Allocate the per-column metadata/buffer arrays for ncols columns. */
static int alloc_columns(dbc_result *r, int ncols)
{
    r->ncols     = ncols;
    r->col_names = calloc((size_t)ncols, sizeof *r->col_names);
    r->col_types = calloc((size_t)ncols, sizeof *r->col_types);
    r->cell      = calloc((size_t)ncols, sizeof *r->cell);
    r->cell_cap  = calloc((size_t)ncols, sizeof *r->cell_cap);
    r->cell_null = calloc((size_t)ncols, sizeof *r->cell_null);
    if (r->col_names == NULL || r->col_types == NULL || r->cell == NULL ||
        r->cell_cap == NULL || r->cell_null == NULL) {
        return -1;
    }
    for (int i = 0; i < ncols; i++) {
        r->cell[i] = malloc(IFX_CELL_INIT_CAP);
        if (r->cell[i] == NULL) {
            return -1;
        }
        r->cell_cap[i] = IFX_CELL_INIT_CAP;
        r->cell[i][0] = '\0';
    }
    return 0;
}

/* Describe each column: cache its name and ODBC SQL type. */
static int describe_columns(dbc_result *r)
{
    for (int i = 0; i < r->ncols; i++) {
        SQLCHAR     name[256];
        SQLSMALLINT name_len = 0;
        SQLSMALLINT sql_type = 0;
        SQLULEN     col_size = 0;
        SQLSMALLINT decimals = 0;
        SQLSMALLINT nullable = 0;
        SQLRETURN rc = SQLDescribeCol(r->stmt, (SQLUSMALLINT)(i + 1), name,
                                      sizeof name, &name_len, &sql_type,
                                      &col_size, &decimals, &nullable);
        if (rc != SQL_SUCCESS && rc != SQL_SUCCESS_WITH_INFO) {
            return -1;
        }
        r->col_types[i] = (short)sql_type;
        size_t n = strlen((const char *)name) + 1;
        r->col_names[i] = malloc(n);
        if (r->col_names[i] == NULL) {
            return -1;
        }
        memcpy(r->col_names[i], name, n);
    }
    return 0;
}

dbc_status ifx_run(dbc_conn *c, const char *sql, dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->dbc == NULL || sql == NULL) {
        return DBC_ERR_PARAM;
    }

    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        return DBC_ERR_NOMEM;
    }

    if (SQLAllocHandle(SQL_HANDLE_STMT, c->dbc, &r->stmt) != SQL_SUCCESS) {
        ifx_stash_diag(c, SQL_HANDLE_DBC, c->dbc, "SQLAllocHandle(STMT)");
        free(r);
        return DBC_ERR_QUERY;
    }

    SQLRETURN rc = SQLExecDirect(r->stmt, (SQLCHAR *)sql, SQL_NTS);
    if (rc != SQL_SUCCESS && rc != SQL_SUCCESS_WITH_INFO) {
        ifx_stash_diag(c, SQL_HANDLE_STMT, r->stmt, "query");
        SQLFreeHandle(SQL_HANDLE_STMT, r->stmt);
        free(r);
        return DBC_ERR_QUERY;
    }

    SQLSMALLINT ncols = 0;
    SQLNumResultCols(r->stmt, &ncols);
    if (ncols <= 0) {
        /* No result set: an INSERT/UPDATE/DDL statement. */
        SQLLEN affected = 0;
        SQLRowCount(r->stmt, &affected);
        r->affected = (long long)affected;
        r->has_resultset = 0;
        SQLFreeHandle(SQL_HANDLE_STMT, r->stmt);
        r->stmt = NULL;
        *out = r;
        return DBC_OK;
    }

    if (alloc_columns(r, ncols) != 0 || describe_columns(r) != 0) {
        ifx_free_result(r);
        return DBC_ERR_NOMEM;
    }
    r->has_resultset = 1;
    *out = r;
    return DBC_OK;
}

dbc_status ifx_query(dbc_conn *c, const char *sql, dbc_result **out)
{
    return ifx_run(c, sql, out);
}

void ifx_free_result(dbc_result *r)
{
    if (r == NULL) {
        return;
    }
    if (r->stmt != NULL) {
        SQLFreeHandle(SQL_HANDLE_STMT, r->stmt);
    }
    free_result_arrays(r);
    free(r);
}

int ifx_col_count(dbc_result *r)
{
    return r != NULL ? r->ncols : 0;
}

const char *ifx_col_name(dbc_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->ncols) {
        return NULL;
    }
    return r->col_names[col];
}

dbc_type ifx_col_type(dbc_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->ncols) {
        return DBC_TYPE_NULL;
    }
    return informix_odbc_type_to_neutral((int)r->col_types[col]);
}

/* Pull one column of the current row into its buffer, growing to fit. Returns 0
   on success (cell_null[col] set when the value is SQL NULL), -1 on error. */
static int fetch_cell(dbc_result *r, int col)
{
    size_t used = 0;
    r->cell_null[col] = 0;
    r->cell[col][0] = '\0';

    for (;;) {
        SQLLEN    ind = 0;
        SQLRETURN rc = SQLGetData(r->stmt, (SQLUSMALLINT)(col + 1), SQL_C_CHAR,
                                  r->cell[col] + used,
                                  (SQLLEN)(r->cell_cap[col] - used), &ind);
        if (rc == SQL_SUCCESS) {
            if (ind == SQL_NULL_DATA) {
                r->cell_null[col] = 1;
            }
            return 0;  /* final (or only) chunk written */
        }
        if (rc == SQL_SUCCESS_WITH_INFO) {
            if (ind == SQL_NULL_DATA) {
                r->cell_null[col] = 1;
                return 0;
            }
            /* Buffer was filled; (cap - used - 1) data bytes landed, more
               remains. Advance past them and grow, then continue the read. */
            used += r->cell_cap[col] - used - 1;
            size_t new_cap = r->cell_cap[col] * 2;
            char *nb = realloc(r->cell[col], new_cap);
            if (nb == NULL) {
                return -1;
            }
            r->cell[col] = nb;
            r->cell_cap[col] = new_cap;
            continue;
        }
        if (rc == SQL_NO_DATA) {
            return 0;  /* nothing more for this column */
        }
        return -1;
    }
}

int ifx_next_row(dbc_result *r)
{
    if (r == NULL || !r->has_resultset || r->stmt == NULL) {
        return 0;
    }
    SQLRETURN rc = SQLFetch(r->stmt);
    if (rc == SQL_NO_DATA) {
        return 0;
    }
    if (rc != SQL_SUCCESS && rc != SQL_SUCCESS_WITH_INFO) {
        return -1;
    }
    for (int i = 0; i < r->ncols; i++) {
        if (fetch_cell(r, i) != 0) {
            return -1;
        }
    }
    return 1;
}

const char *ifx_cell_text(dbc_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->ncols) {
        return NULL;
    }
    if (r->cell_null[col]) {
        return NULL;
    }
    return r->cell[col];
}

long long ifx_rows_affected(dbc_result *r)
{
    return r != NULL ? r->affected : 0;
}
