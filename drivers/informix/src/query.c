#include "internal.h"
#include "utils/drda_types.h"
#include "utils/txsql.h"

#include <stdlib.h>
#include <string.h>

/*
 * Query execution and result iteration over DRDA (libdrda). A statement that
 * returns rows keeps its cursor open and fetches block by block; libdrda gives
 * each result a package section of its own, so the core can page one cursor
 * while other statements run on the same connection. Cells come back as UTF-8
 * text, converted from the database's code set by libdrda.
 *
 * DRDA has no autocommit: a unit of work starts by itself and lasts until a
 * commit. The ODBC driver ran in autocommit, and the app relies on that, so
 * outside an explicit transaction (begin, or BEGIN WORK typed in the editor)
 * every statement is committed as soon as it has run, a query as soon as its
 * cursor is open. A commit leaves open cursors open (libdrda's are held). In
 * a database without a log the server commits on its own and refuses the
 * request with -256; the first refusal marks the connection so no more are
 * sent.
 */

#define IFX_NO_TRANSACTION (-256)

/* Commit after a statement outside an explicit transaction. */
static dbc_status autocommit(dbc_conn *c)
{
    int rc;
    if (c->in_tx || c->no_log) {
        return DBC_OK;
    }
    ifx_busy(c, 1);
    rc = drda_commit(c->d);
    ifx_busy(c, 0);
    if (rc < 0) {
        if (drda_sqlcode(c->d) == IFX_NO_TRANSACTION) {
            c->no_log = 1;
            return DBC_OK;
        }
        ifx_stash_drda(c, "commit");
        return ifx_failure_status(c);
    }
    return DBC_OK;
}

/* End an explicit transaction. In a database without a log there is none to
   end: say so rather than pretend. */
static dbc_status end_tx(dbc_conn *c, int commit)
{
    int rc;
    if (c == NULL || c->d == NULL) {
        return DBC_ERR_PARAM;
    }
    ifx_busy(c, 1);
    rc = commit ? drda_commit(c->d) : drda_rollback(c->d);
    ifx_busy(c, 0);
    c->in_tx = 0;
    if (rc < 0) {
        if (drda_sqlcode(c->d) == IFX_NO_TRANSACTION) {
            c->no_log = 1;
        }
        ifx_stash_drda(c, commit ? "commit" : "rollback");
        return ifx_failure_status(c);
    }
    return DBC_OK;
}

dbc_status ifx_begin(dbc_conn *c)
{
    if (c == NULL || c->d == NULL) {
        return DBC_ERR_PARAM;
    }
    if (c->no_log) {
        ifx_set_err(c, "begin: this database has no transaction log (SQLCODE -256)");
        return DBC_ERR_QUERY;
    }
    /* Whatever ran before is committed already; the transaction starts here. */
    c->in_tx = 1;
    return DBC_OK;
}

dbc_status ifx_commit(dbc_conn *c)   { return end_tx(c, 1); }
dbc_status ifx_rollback(dbc_conn *c) { return end_tx(c, 0); }

/* A result with no columns and no rows, as a statement with no result set. */
static dbc_status empty_result(dbc_conn *c, dbc_result **out)
{
    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        return DBC_ERR_NOMEM;
    }
    r->conn = c;
    *out = r;
    return DBC_OK;
}

dbc_status ifx_run(dbc_conn *c, const char *sql, dbc_result **out)
{
    drda_result *dr = NULL;
    dbc_result *r;
    dbc_status st;
    int rc;
    *out = NULL;
    if (c == NULL || c->d == NULL || sql == NULL) {
        return DBC_ERR_PARAM;
    }

    switch (informix_tx_statement(sql)) {
    case IFX_TX_BEGIN:
        st = ifx_begin(c);
        return st == DBC_OK ? empty_result(c, out) : st;
    case IFX_TX_COMMIT:
    case IFX_TX_ROLLBACK:
        st = end_tx(c, informix_tx_statement(sql) == IFX_TX_COMMIT);
        return st == DBC_OK ? empty_result(c, out) : st;
    case IFX_TX_NONE:
        break;
    }

    ifx_busy(c, 1);
    rc = drda_query(c->d, sql, &dr);
    ifx_busy(c, 0);
    if (rc < 0) {
        ifx_stash_drda(c, "query");
        return ifx_failure_status(c);
    }

    r = calloc(1, sizeof *r);
    if (r == NULL) {
        drda_free(dr);
        return DBC_ERR_NOMEM;
    }
    r->conn = c;
    r->ncols = drda_col_count(dr);
    if (r->ncols == 0) {
        /* INSERT/UPDATE/DDL: done, commit it. */
        r->affected = drda_rows_affected(dr);
        drda_free(dr);
        st = autocommit(c);
        if (st != DBC_OK) {
            free(r);
            return st;
        }
    } else {
        /* A query too: an open unit of work would keep its table locked
           against other sessions (a CREATE INDEX elsewhere failed with -242
           while the grid paged). The cursor survives the commit: it is held. */
        r->r = dr;
        st = autocommit(c);
        if (st != DBC_OK) {
            ifx_free_result(r);
            return st;
        }
    }
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
    if (r->r != NULL) {
        drda_free(r->r);
    }
    free(r->synth_sql);
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
    return r->synth_sql != NULL ? "sql" : drda_col_name(r->r, col);
}

dbc_type ifx_col_type(dbc_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->ncols) {
        return DBC_TYPE_NULL;
    }
    return r->synth_sql != NULL ? DBC_TYPE_TEXT
                                : informix_drda_type_to_neutral(drda_col_sqltype(r->r, col));
}

int ifx_next_row(dbc_result *r)
{
    int rc;
    if (r == NULL) {
        return 0;
    }
    if (r->synth_sql != NULL) {
        if (r->synth_done) {
            return 0;
        }
        r->synth_done = 1;
        return 1;
    }
    if (r->r == NULL) {
        return 0;
    }
    ifx_busy(r->conn, 1);
    rc = drda_next(r->r);
    ifx_busy(r->conn, 0);
    if (rc < 0) {
        /* The core reads last_error when next_row fails: leave a reason. */
        ifx_stash_drda(r->conn, "fetch");
        return -1;
    }
    return rc;
}

const char *ifx_cell_text(dbc_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->ncols) {
        return NULL;
    }
    if (r->synth_sql != NULL) {
        return r->synth_sql;
    }
    return drda_text(r->r, col);
}

long long ifx_rows_affected(dbc_result *r)
{
    return r != NULL ? r->affected : 0;
}

dbc_status ifx_make_synthetic_sql(const char *sql, dbc_result **out)
{
    dbc_result *r;
    size_t n;
    *out = NULL;
    if (sql == NULL) {
        return DBC_ERR_PARAM;
    }
    r = calloc(1, sizeof *r);
    n = strlen(sql) + 1;
    if (r == NULL || (r->synth_sql = malloc(n)) == NULL) {
        free(r);
        return DBC_ERR_NOMEM;
    }
    memcpy(r->synth_sql, sql, n);
    r->ncols = 1;
    *out = r;
    return DBC_OK;
}
