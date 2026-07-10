#include "internal.h"
#include "utils/types.h"

#include <stdlib.h>

/*
 * Query execution and result iteration.
 *
 * A result-set statement (col_count > 0) is left un-stepped: the core pulls rows
 * via sqlite_next_row. A statement with no result set (INSERT/UPDATE/DDL) is
 * executed eagerly here so rows_affected is meaningful, because the core reads
 * rows_affected without iterating.
 *
 * On any error the driver returns DBC_ERR_QUERY; the reason is SQLite's own
 * message, surfaced through sqlite_last_error (sqlite3_errmsg on the shared db).
 */
dbc_status sqlite_query(dbc_conn *c, const char *sql, dbc_result **out)
{
    *out = NULL;

    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        return DBC_ERR_NOMEM;
    }

    int rc = sqlite3_prepare_v2(c->db, sql, -1, &r->stmt, NULL);
    if (rc != SQLITE_OK) {
        sqlite3_finalize(r->stmt);
        free(r);
        return DBC_ERR_QUERY;
    }

    /* Empty input (blank or comment-only) prepares to no statement. */
    if (r->stmt == NULL) {
        *out = r;
        return DBC_OK;
    }

    r->col_count = sqlite3_column_count(r->stmt);
    if (r->col_count == 0) {
        rc = sqlite3_step(r->stmt);
        if (rc != SQLITE_DONE && rc != SQLITE_ROW) {
            sqlite3_finalize(r->stmt);
            free(r);
            return DBC_ERR_QUERY;
        }
        r->rows_affected = sqlite3_changes64(c->db);  /* 64-bit, no truncation */
    }

    *out = r;
    return DBC_OK;
}

void sqlite_free_result(dbc_result *r)
{
    if (r == NULL) {
        return;
    }
    sqlite3_finalize(r->stmt);
    free(r);
}

int sqlite_col_count(dbc_result *r)
{
    return r != NULL ? r->col_count : 0;
}

const char *sqlite_col_name(dbc_result *r, int col)
{
    if (r->stmt == NULL) {
        return NULL;
    }
    return sqlite3_column_name(r->stmt, col);
}

dbc_type sqlite_col_type(dbc_result *r, int col)
{
    if (r->stmt == NULL) {
        return DBC_TYPE_NULL;
    }
    return sqlite_affinity(sqlite3_column_decltype(r->stmt, col));
}

int sqlite_next_row(dbc_result *r)
{
    if (r->stmt == NULL || r->col_count == 0) {
        return 0;
    }
    int rc = sqlite3_step(r->stmt);
    if (rc == SQLITE_ROW) {
        return 1;
    }
    if (rc == SQLITE_DONE) {
        return 0;
    }
    return -1;  /* error; the core reads sqlite_last_error */
}

const char *sqlite_cell_text(dbc_result *r, int col)
{
    if (r == NULL || r->stmt == NULL) {
        return NULL;
    }
    if (sqlite3_column_type(r->stmt, col) == SQLITE_NULL) {
        return NULL;
    }
    return (const char *)sqlite3_column_text(r->stmt, col);
}

long long sqlite_rows_affected(dbc_result *r)
{
    return r != NULL ? r->rows_affected : 0;
}

/* Run a control statement (BEGIN/COMMIT/ROLLBACK) with no result set. On error
   SQLite's own message is left on the connection for sqlite_last_error. */
static dbc_status sqlite_exec_control(dbc_conn *c, const char *sql)
{
    if (c == NULL || c->db == NULL) {
        return DBC_ERR_PARAM;
    }
    int rc = sqlite3_exec(c->db, sql, NULL, NULL, NULL);
    return rc == SQLITE_OK ? DBC_OK : DBC_ERR_QUERY;
}

dbc_status sqlite_begin(dbc_conn *c)    { return sqlite_exec_control(c, "BEGIN"); }
dbc_status sqlite_commit(dbc_conn *c)   { return sqlite_exec_control(c, "COMMIT"); }
dbc_status sqlite_rollback(dbc_conn *c) { return sqlite_exec_control(c, "ROLLBACK"); }

/*
 * Interrupt the query running on c (DBC_FEAT_CANCEL). sqlite3_interrupt is the
 * SQLite primitive purpose-built for this: it is explicitly safe to call from a
 * DIFFERENT thread than the one inside sqlite3_step, and it makes that step (and
 * the ones after it, until the statement resets) return SQLITE_INTERRUPT — which
 * sqlite_next_row / sqlite_query already surface as DBC_ERR_QUERY ("interrupted").
 * A no-op with no running statement, so calling it after the query finished is
 * harmless.
 */
dbc_status sqlite_cancel(dbc_conn *c)
{
    if (c == NULL || c->db == NULL) {
        return DBC_ERR_UNSUPPORTED;
    }
    sqlite3_interrupt(c->db);
    return DBC_OK;
}
