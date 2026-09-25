#include "internal.h"
#include "utils/types.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Query execution over libtdswire (issue #584). Same contract as query.c: the
 * LAST result set with columns is kept, whole, and the row counts of the
 * statements without one are summed. libtdswire already gives every value as
 * UTF-8 text in SQL Server's own form; only binary is formatted here, as 0x...
 */

/* libtdswire reports the type byte on the wire; utils/types.h speaks db-lib's
   codes, which are the same except for the two binary types db-lib folds. */
static int coltype(unsigned type)
{
    switch (type) {
    case 0xA5: return MSSQL_T_VARBINARY; /* BIGVARBINARY */
    case 0xAD: return MSSQL_T_BINARY;    /* BIGBINARY */
    default: return (int)type;
    }
}

static int is_binary(int type)
{
    return type == MSSQL_T_BINARY || type == MSSQL_T_VARBINARY || type == MSSQL_T_IMAGE ||
           type == 0xF0; /* UDT: hierarchyid, geometry... */
}

static char *dup_bytes(const char *src, size_t n)
{
    char *s = malloc(n + 1);
    if (s != NULL) {
        memcpy(s, src, n);
        s[n] = '\0';
    }
    return s;
}

static void clear_rows(dbc_result *r)
{
    for (long long i = 0; i < r->nrows * r->ncols; i++) {
        free(r->cells[i]);
    }
    free(r->cells);
    for (int i = 0; i < r->ncols; i++) {
        free(r->names[i]);
    }
    free(r->names);
    free(r->types);
    r->cells = NULL;
    r->names = NULL;
    r->types = NULL;
    r->nrows = 0;
    r->cap_rows = 0;
    r->ncols = 0;
}

/* The owned text of the current row's `col`, or NULL for SQL NULL. */
static char *cell_value(tw_result *tr, int col, int type, int *oom)
{
    const char *t = tw_text(tr, col);
    size_t len = tw_len(tr, col);
    char *text;
    if (t == NULL) {
        return NULL;
    }
    if (is_binary(type)) {
        size_t cap = 2 * len + 3;
        text = malloc(cap);
        if (text != NULL && !mssql_format_binary((const unsigned char *)t, len, text, cap)) {
            free(text);
            text = NULL;
        }
    } else {
        text = dup_bytes(t, len);
    }
    if (text == NULL) {
        *oom = 1;
    }
    return text;
}

/* Replace r's result set with the current one of tr, read to its end. */
static dbc_status capture(tw_conn *tw, tw_result *tr, dbc_result *r)
{
    clear_rows(r);
    int ncols = tw_col_count(tr);
    r->names = calloc((size_t)ncols, sizeof *r->names);
    r->types = calloc((size_t)ncols, sizeof *r->types);
    if (r->names == NULL || r->types == NULL) {
        return DBC_ERR_NOMEM;
    }
    r->ncols = ncols;
    for (int i = 0; i < ncols; i++) {
        const tw_column *col = tw_col(tr, i);
        r->names[i] = dup_bytes(col->name, strlen(col->name));
        r->types[i] = coltype(col->type);
        if (r->names[i] == NULL) {
            return DBC_ERR_NOMEM;
        }
    }
    int rc;
    while ((rc = tw_next(tr)) > 0) {
        if (r->nrows == r->cap_rows) {
            long long cap = r->cap_rows != 0 ? r->cap_rows * 2 : 64;
            char **cells = realloc(r->cells, (size_t)(cap * ncols) * sizeof *cells);
            if (cells == NULL) {
                return DBC_ERR_NOMEM;
            }
            r->cells = cells;
            r->cap_rows = cap;
        }
        int oom = 0;
        for (int i = 0; i < ncols; i++) {
            r->cells[r->nrows * ncols + i] = cell_value(tr, i, r->types[i], &oom);
        }
        r->nrows++;
        if (oom) {
            return DBC_ERR_NOMEM;
        }
    }
    if (rc < 0) {
        return tw_conn_lost(tw) ? DBC_ERR_CONN : DBC_ERR_QUERY;
    }
    return DBC_OK;
}

dbc_status ms_drv_query(dbc_conn *c, const char *sql, dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->tw == NULL || sql == NULL) {
        return DBC_ERR_PARAM;
    }
    c->err[0] = '\0';
    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        return DBC_ERR_NOMEM;
    }
    r->row = -1;
    tw_result *tr = NULL;
    dbc_status st = DBC_OK;
    if (tw_query(c->tw, sql, strlen(sql), &tr) < 0) {
        st = tw_conn_lost(c->tw) ? DBC_ERR_CONN : DBC_ERR_QUERY;
    } else {
        int more = tw_col_count(tr) > 0;
        while (st == DBC_OK && more) {
            st = capture(c->tw, tr, r);
            if (st == DBC_OK) {
                int rc = tw_next_result(tr);
                if (rc < 0) {
                    st = tw_conn_lost(c->tw) ? DBC_ERR_CONN : DBC_ERR_QUERY;
                }
                more = rc > 0;
            }
        }
        if (st == DBC_OK) {
            r->affected = tw_rows_affected(tr);
        }
    }
    if (st != DBC_OK) {
        snprintf(c->err, sizeof c->err, "%s", tw_error(c->tw));
        tw_free(tr);
        ms_drv_free_result(r);
        return st;
    }
    tw_free(tr);
    *out = r;
    return DBC_OK;
}

void ms_drv_free_result(dbc_result *r)
{
    if (r == NULL) {
        return;
    }
    clear_rows(r);
    free(r);
}

int ms_drv_col_count(dbc_result *r)
{
    return r != NULL ? r->ncols : 0;
}

const char *ms_drv_col_name(dbc_result *r, int col)
{
    return (r != NULL && col >= 0 && col < r->ncols) ? r->names[col] : NULL;
}

dbc_type ms_drv_col_type(dbc_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->ncols) {
        return DBC_TYPE_NULL;
    }
    return mssql_type_to_neutral(r->types[col]);
}

int ms_drv_next_row(dbc_result *r)
{
    if (r == NULL) {
        return 0;
    }
    if (r->row + 1 < r->nrows) {
        r->row++;
        return 1;
    }
    r->row = r->nrows; /* park at the end so repeated calls keep returning 0 */
    return 0;
}

const char *ms_drv_cell_text(dbc_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->ncols || r->row < 0 || r->row >= r->nrows) {
        return NULL;
    }
    return r->cells[r->row * r->ncols + col];
}

long long ms_drv_rows_affected(dbc_result *r)
{
    return r != NULL ? r->affected : 0;
}

/* Run a statement with no result set to keep. */
static dbc_status exec_control(dbc_conn *c, const char *sql)
{
    dbc_result *r = NULL;
    dbc_status st = ms_drv_query(c, sql, &r);
    ms_drv_free_result(r);
    return st;
}

dbc_status ms_drv_begin(dbc_conn *c)
{
    return exec_control(c, "BEGIN TRANSACTION");
}

dbc_status ms_drv_commit(dbc_conn *c)
{
    return exec_control(c, "COMMIT TRANSACTION");
}

dbc_status ms_drv_rollback(dbc_conn *c)
{
    return exec_control(c, "ROLLBACK TRANSACTION");
}
