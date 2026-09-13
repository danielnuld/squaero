#include "internal.h"
#include "utils/types.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Query execution and result iteration over db-lib. A batch may return several
 * results (statements, row counts, result sets); like the PostgreSQL driver this
 * one keeps the LAST result set that has columns, and sums the row counts of the
 * statements that report one. Every result is read to the end, because a
 * DBPROCESS refuses the next command while rows are pending.
 */

/* The type codes in utils/types.h are FreeTDS's; stop the build if they drift.
   Cast to int: they are two different enums, which -Wenum-compare rejects.
   (SYBUNIQUE is not in the public sybdb.h, so it cannot be checked here.) */
#define SAME(a, b) ((int)(a) == (int)(b))
_Static_assert(SAME(MSSQL_T_INT4, SYBINT4) && SAME(MSSQL_T_INT8, SYBINT8) &&
               SAME(MSSQL_T_INTN, SYBINTN) && SAME(MSSQL_T_NUMERIC, SYBNUMERIC) &&
               SAME(MSSQL_T_BITN, SYBBITN) && SAME(MSSQL_T_MSDATE, SYBMSDATE) &&
               SAME(MSSQL_T_MSDATETIME2, SYBMSDATETIME2) &&
               SAME(MSSQL_T_MSDATETIMEOFFSET, SYBMSDATETIMEOFFSET) &&
               SAME(MSSQL_T_DATETIMN, SYBDATETIMN) && SAME(MSSQL_T_VARBINARY, SYBVARBINARY) &&
               SAME(MSSQL_T_MONEYN, SYBMONEYN),
               "utils/types.h codes must match FreeTDS's SYB* values");
#undef SAME

static char *dup_bytes(const char *src, size_t n)
{
    char *s = malloc(n + 1);
    if (s != NULL) {
        memcpy(s, src, n);
        s[n] = '\0';
    }
    return s;
}

static int is_datetime(int type)
{
    switch (type) {
    case SYBMSDATE: case SYBMSTIME: case SYBMSDATETIME2: case SYBMSDATETIMEOFFSET:
    case SYBDATETIME: case SYBDATETIME4: case SYBDATETIMN:
        return 1;
    default:
        return 0;
    }
}

static int is_binary(int type)
{
    return type == SYBBINARY || type == SYBVARBINARY || type == SYBIMAGE;
}

static int is_character(int type)
{
    return type == SYBCHAR || type == SYBVARCHAR || type == SYBTEXT ||
           type == SYBNTEXT || type == SYBNVARCHAR;
}

/* The owned text of the current row's `col`, or NULL for SQL NULL. *oom is set
   when an allocation fails. */
static char *cell_value(DBPROCESS *dbproc, int col, int type, int *oom)
{
    BYTE *data = dbdata(dbproc, col);
    DBINT len = dbdatlen(dbproc, col);
    if (data == NULL) {
        return NULL; /* SQL NULL */
    }
    char *text = NULL;
    if (is_character(type)) {
        /* Already in the client charset (UTF-8, set at login). */
        text = dup_bytes((const char *)data, (size_t)len);
    } else if (is_binary(type)) {
        size_t cap = 2 * (size_t)len + 3;
        text = malloc(cap);
        if (text != NULL && !mssql_format_binary(data, (size_t)len, text, cap)) {
            free(text);
            text = NULL;
        }
    } else if (is_datetime(type)) {
        DBDATEREC2 rec;
        char buf[64];
        if (dbanydatecrack(dbproc, &rec, type, data) == SUCCEED) {
            mssql_datetime_parts p = {
                rec.dateyear, rec.datemonth + 1, rec.datedmonth,
                rec.datehour, rec.dateminute, rec.datesecond,
                rec.datensecond, rec.datetzone,
            };
            if (mssql_format_datetime(type, &p, buf, sizeof buf)) {
                return (text = dup_bytes(buf, strlen(buf))) != NULL ? text : (*oom = 1, NULL);
            }
        }
        /* Fall through to db-lib's own rendering if cracking fails. */
    }
    if (text == NULL && !is_character(type) && !is_binary(type)) {
        /* Numbers, money, bit, uniqueidentifier, xml, variant, …: db-lib's own
           conversion to text. Generous room for the long ones (xml, variant). */
        DBINT cap = len * 4 + 64;
        text = malloc((size_t)cap + 1);
        if (text != NULL) {
            DBINT n = dbconvert(dbproc, type, data, len, SYBCHAR, (BYTE *)text, cap);
            if (n < 0) {
                n = 0;
            }
            text[n] = '\0';
        }
    }
    if (text == NULL) {
        *oom = 1;
    }
    return text;
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

/* Replace r's result set with the columns and rows of the current db-lib result. */
static dbc_status capture(DBPROCESS *dbproc, dbc_result *r)
{
    clear_rows(r);
    int ncols = dbnumcols(dbproc);
    r->names = calloc((size_t)ncols, sizeof *r->names);
    r->types = calloc((size_t)ncols, sizeof *r->types);
    if (r->names == NULL || r->types == NULL) {
        return DBC_ERR_NOMEM;
    }
    r->ncols = ncols;
    for (int i = 0; i < ncols; i++) {
        const char *name = dbcolname(dbproc, i + 1);
        r->names[i] = dup_bytes(name != NULL ? name : "", name != NULL ? strlen(name) : 0);
        r->types[i] = dbcoltype(dbproc, i + 1);
        if (r->names[i] == NULL) {
            return DBC_ERR_NOMEM;
        }
    }
    int status;
    while ((status = dbnextrow(dbproc)) != NO_MORE_ROWS) {
        if (status == FAIL) {
            return DBC_ERR_QUERY;
        }
        if (status != REG_ROW) {
            continue; /* compute rows (COMPUTE BY) are not part of the grid */
        }
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
            r->cells[r->nrows * ncols + i] = cell_value(dbproc, i + 1, r->types[i], &oom);
        }
        r->nrows++;
        if (oom) {
            return DBC_ERR_NOMEM;
        }
    }
    return DBC_OK;
}

dbc_status ms_drv_query(dbc_conn *c, const char *sql, dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->dbproc == NULL || sql == NULL) {
        return DBC_ERR_PARAM;
    }
    c->err[0] = '\0';
    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        return DBC_ERR_NOMEM;
    }
    r->row = -1;

    if (dbcmd(c->dbproc, sql) == FAIL || dbsqlexec(c->dbproc) == FAIL) {
        ms_drv_free_result(r);
        dbcancel(c->dbproc);
        return dbdead(c->dbproc) ? DBC_ERR_CONN : DBC_ERR_QUERY;
    }

    dbc_status st = DBC_OK;
    RETCODE rc;
    while ((rc = dbresults(c->dbproc)) != NO_MORE_RESULTS) {
        if (rc == FAIL) {
            st = DBC_ERR_QUERY;
            break;
        }
        if (dbnumcols(c->dbproc) > 0) {
            st = capture(c->dbproc, r);
            if (st != DBC_OK) {
                break;
            }
            continue; /* a SELECT's row count is its rows, not rows affected */
        }
        if (dbcanquery(c->dbproc) == FAIL) {
            st = DBC_ERR_QUERY;
            break;
        }
        DBINT count = DBCOUNT(c->dbproc);
        if (count >= 0) {
            r->affected += count;
        }
    }
    if (st != DBC_OK) {
        dbcancel(c->dbproc); /* discard whatever the batch still had pending */
        ms_drv_free_result(r);
        return dbdead(c->dbproc) ? DBC_ERR_CONN : st;
    }
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
