#include "internal.h"
#include "utils/odbc_types.h"
#include "utils/text.h"
#include "utils/utf16.h"

#include <stdint.h>
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
    if (r->cellu8 != NULL) {
        for (int i = 0; i < r->ncols; i++) {
            free(r->cellu8[i]);
        }
        free(r->cellu8);
    }
    free(r->col_types);
    free(r->cell_cap);
    free(r->cell_null);
    free(r->cellu8_cap);
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
    /* UTF-8 conversion buffers are grown on demand in ifx_cell_text. */
    r->cellu8     = calloc((size_t)ncols, sizeof *r->cellu8);
    r->cellu8_cap = calloc((size_t)ncols, sizeof *r->cellu8_cap);
    if (r->col_names == NULL || r->col_types == NULL || r->cell == NULL ||
        r->cell_cap == NULL || r->cell_null == NULL || r->cellu8 == NULL ||
        r->cellu8_cap == NULL) {
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

/*
 * How many of the characters a describe call reported are safe to read out of a
 * buffer of `cap` elements. name_len counts the characters *available*, so it
 * exceeds the buffer when the name was truncated; and a driver may terminate
 * earlier than it claimed, so an embedded NUL still wins. Never trust plain
 * NUL-termination here: a driver that cannot represent a name through the entry
 * point it was asked with may leave the buffer untouched, and a strlen over that
 * runs off the end of the array.
 */
static size_t describe_name_len(SQLSMALLINT name_len, size_t cap)
{
    size_t avail = (name_len > 0) ? (size_t)name_len : 0;
    return (avail > cap - 1) ? cap - 1 : avail;
}

/* Describe each column: cache its name and ODBC SQL type. */
static int describe_columns(dbc_result *r)
{
    for (int i = 0; i < r->ncols; i++) {
        SQLCHAR     name[256] = { 0 };
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

        size_t len = describe_name_len(name_len, sizeof name);
        const void *nul = memchr(name, '\0', len);
        if (nul != NULL) {
            len = (size_t)((const SQLCHAR *)nul - name);
        }
        name[len] = '\0';

        /* A column name is text from the database too, so it gets the same UTF-8
           treatment as a cell value — an accented alias in a single-byte code set
           would otherwise be exactly as unsafe to transport. Converting once here
           keeps ifx_col_name a plain accessor and honours its stable-pointer
           contract without a second buffer. */
        r->col_names[i] = ifx_text_to_utf8_dup((const char *)name);
        if (r->col_names[i] == NULL) {
            return -1;
        }
        r->col_types[i] = (short)sql_type;
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
        return ifx_failure_status(c);
    }

    /* Publish the statement so a concurrent ifx_cancel can SQLCancel it while the
       (possibly long) SQLExecDirect / SQLFetch below runs. r->conn lets the free
       paths untrack it. */
    r->conn = c;
    ifx_track_stmt(c, r->stmt);

    /* A statement whose accents all live inside string literals goes through the
       wide entry point, so the driver converts it to the database's code set. The
       ANSI SQLExecDirect passes the bytes through untouched, which against a
       single-byte database makes an accented literal match nothing at all —
       silently, no error (issue #324). See ifx_sql_wide_safe for why the wide path
       is deliberately not used for non-ASCII outside a literal.
       A statement that is not well-formed UTF-8 also falls back: the conversion
       returns NULL rather than guessing, and the old path is no worse than today. */
    SQLRETURN rc;
    unsigned short *wsql = ifx_sql_wide_safe(sql) ? ifx_utf8_to_utf16(sql, NULL)
                                                  : NULL;
    if (wsql != NULL) {
        rc = SQLExecDirectW(r->stmt, (SQLWCHAR *)wsql, SQL_NTS);
        free(wsql);
    } else {
        rc = SQLExecDirect(r->stmt, (SQLCHAR *)sql, SQL_NTS);
    }
    if (rc != SQL_SUCCESS && rc != SQL_SUCCESS_WITH_INFO) {
        ifx_stash_diag(c, SQL_HANDLE_STMT, r->stmt, "query");
        ifx_untrack_stmt(c, r->stmt);
        SQLFreeHandle(SQL_HANDLE_STMT, r->stmt);
        free(r);
        return ifx_failure_status(c);
    }

    SQLSMALLINT ncols = 0;
    SQLNumResultCols(r->stmt, &ncols);
    if (ncols <= 0) {
        /* No result set: an INSERT/UPDATE/DDL statement. */
        SQLLEN affected = 0;
        SQLRowCount(r->stmt, &affected);
        r->affected = (long long)affected;
        r->has_resultset = 0;
        ifx_untrack_stmt(c, r->stmt);
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
        /* Stop tracking before freeing so a cancel racing in cannot SQLCancel a
           freed handle: ifx_untrack_stmt clears active_stmt under the same lock
           ifx_cancel holds, so once this returns no cancel is mid-flight on it. */
        if (r->conn != NULL) {
            ifx_untrack_stmt(r->conn, r->stmt);
        }
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
    if (r == NULL) {
        return 0;
    }
    if (r->synthetic) {
        /* One pre-materialized row, no ODBC cursor to step. */
        if (r->synth_done) {
            return 0;
        }
        r->synth_done = 1;
        return 1;
    }
    if (!r->has_resultset || r->stmt == NULL) {
        return 0;
    }
    /* Both failure paths below must leave a reason behind: the core reads
       last_error when next_row returns -1, and returning -1 without stashing the
       diagnostic is how a failed fetch used to surface as a bare "query failed"
       with nothing to act on. A row the engine refuses to convert does that
       (issue #323). */
    SQLRETURN rc = SQLFetch(r->stmt);
    if (rc == SQL_NO_DATA) {
        return 0;
    }
    if (rc != SQL_SUCCESS && rc != SQL_SUCCESS_WITH_INFO) {
        ifx_stash_diag(r->conn, SQL_HANDLE_STMT, r->stmt, "fetch");
        return -1;
    }
    for (int i = 0; i < r->ncols; i++) {
        if (fetch_cell(r, i) != 0) {
            ifx_stash_diag(r->conn, SQL_HANDLE_STMT, r->stmt, "fetch");
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
    /* The neutral contract and the JSON/webview transport require UTF-8. The
       connection asks the CSDK for it, so this is normally a pass-through; the
       safety net matters when that request was overridden or ignored (see
       utils/text.h). On allocation failure hand back the raw bytes: the core's own
       boundary guard will still make them safe to transport. */
    const char *u = ifx_text_to_utf8(r->cell[col], &r->cellu8[col],
                                     &r->cellu8_cap[col]);
    return u != NULL ? u : r->cell[col];
}

long long ifx_rows_affected(dbc_result *r)
{
    return r != NULL ? r->affected : 0;
}

dbc_status ifx_make_synthetic_sql(const char *sql, dbc_result **out)
{
    *out = NULL;
    if (sql == NULL) {
        return DBC_ERR_PARAM;
    }
    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        return DBC_ERR_NOMEM;
    }
    if (alloc_columns(r, 1) != 0) {
        ifx_free_result(r);
        return DBC_ERR_NOMEM;
    }
    r->col_names[0] = malloc(4);
    if (r->col_names[0] == NULL) {
        ifx_free_result(r);
        return DBC_ERR_NOMEM;
    }
    memcpy(r->col_names[0], "sql", 4);
    r->col_types[0] = (short)SQL_CHAR;

    size_t len = strlen(sql) + 1;
    if (len > r->cell_cap[0]) {
        char *nb = realloc(r->cell[0], len);
        if (nb == NULL) {
            ifx_free_result(r);
            return DBC_ERR_NOMEM;
        }
        r->cell[0] = nb;
        r->cell_cap[0] = len;
    }
    memcpy(r->cell[0], sql, len);
    r->cell_null[0] = 0;

    r->synthetic = 1;
    r->has_resultset = 1;
    *out = r;
    return DBC_OK;
}

dbc_status ifx_begin(dbc_conn *c)
{
    if (c == NULL || c->dbc == NULL) {
        return DBC_ERR_PARAM;
    }
    SQLRETURN rc = SQLSetConnectAttr(c->dbc, SQL_ATTR_AUTOCOMMIT,
                                     (SQLPOINTER)(uintptr_t)SQL_AUTOCOMMIT_OFF,
                                     SQL_IS_INTEGER);
    if (rc != SQL_SUCCESS && rc != SQL_SUCCESS_WITH_INFO) {
        ifx_stash_diag(c, SQL_HANDLE_DBC, c->dbc, "begin");
        return ifx_failure_status(c);
    }
    return DBC_OK;
}

/* Commit or roll back, then restore autocommit so subsequent statements are not
   silently held in an open transaction. */
static dbc_status ifx_end_tran(dbc_conn *c, SQLSMALLINT how, const char *ctx)
{
    if (c == NULL || c->dbc == NULL) {
        return DBC_ERR_PARAM;
    }
    SQLRETURN rc = SQLEndTran(SQL_HANDLE_DBC, c->dbc, how);
    dbc_status st = DBC_OK;
    if (rc != SQL_SUCCESS && rc != SQL_SUCCESS_WITH_INFO) {
        ifx_stash_diag(c, SQL_HANDLE_DBC, c->dbc, ctx);
        st = ifx_failure_status(c);
    }
    SQLSetConnectAttr(c->dbc, SQL_ATTR_AUTOCOMMIT,
                      (SQLPOINTER)(uintptr_t)SQL_AUTOCOMMIT_ON, SQL_IS_INTEGER);
    return st;
}

dbc_status ifx_commit(dbc_conn *c)   { return ifx_end_tran(c, SQL_COMMIT, "commit"); }
dbc_status ifx_rollback(dbc_conn *c) { return ifx_end_tran(c, SQL_ROLLBACK, "rollback"); }
