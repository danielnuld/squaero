#ifndef QUAERO_INFORMIX_INTERNAL_H
#define QUAERO_INFORMIX_INTERNAL_H

/*
 * Internal definitions shared across the Informix driver translation units.
 * The only public symbol is dbc_driver_entry. The engine is reached over DRDA
 * through libdrda (issue #557): the server's drsoctcp (or drsocssl) listener,
 * with no IBM Client SDK. On Windows, a server without a DRDA listener is
 * reached over SQLI instead, through a Client SDK installed on the machine
 * (sqli.h). Vtable functions carry an `ifx_` prefix.
 */

#include "dbcore/driver.h"
#include "drda.h"
#include "sqli.h"

#include <stddef.h>

#if defined(_WIN32)
#  include <windows.h>
typedef CRITICAL_SECTION ifx_mutex;
#else
#  include <pthread.h>
typedef pthread_mutex_t ifx_mutex;
#endif

/* A live connection. */
struct dbc_conn {
    /* Exactly one of d and s is set once connected: DRDA, or the SQLI
       fallback. Both NULL until then (or after a failed connect). */
    drda_conn *d;
    ifx_sqli  *s;
    char       err[1024];   /* last error */
    /* An explicit transaction is open (begin, or BEGIN WORK typed in the
       editor). Outside one the driver commits after every statement, as the
       ODBC driver's autocommit did: DRDA has no autocommit of its own. */
    int        in_tx;
    /* The database has no transaction log: every statement is committed as it
       runs and a commit request fails with -256, so none is sent. */
    int        no_log;
    /* A call that talks to the server is in flight: what ifx_cancel cuts.
       Guarded by lock, which also keeps disconnect from closing the connection
       while a cancel is shutting its socket. */
    int        busy;
    ifx_mutex  lock;
};

/*
 * A result: a libdrda result, or a synthetic one-row result holding generated
 * SQL (build_dml, get_ddl), which never touches the server.
 */
struct dbc_result {
    dbc_conn    *conn;
    drda_result *r;          /* a DRDA result with rows, or NULL */
    ifx_sqli_result *sr;     /* an SQLI result with rows, or NULL */
    int          ncols;
    long long    affected;
    char        *synth_sql;  /* the one "sql" cell of a synthetic result */
    int          synth_done;
};

/* 1 when c is connected, over either backend. */
static inline int ifx_connected(const dbc_conn *c)
{
    return c != NULL && (c->d != NULL || c->s != NULL);
}

/* --- connection.c --- */
dbc_status  ifx_connect(const char *dsn_json, dbc_conn **out);
void        ifx_disconnect(dbc_conn *c);
const char *ifx_last_error(dbc_conn *c);
/* Set a plain driver-side error reason on the connection. */
void        ifx_set_err(dbc_conn *c, const char *msg);
/* Copy the backend's last error onto the connection, prefixed with ctx. */
void        ifx_stash(dbc_conn *c, const char *ctx);
/* The status a just-failed call should report: DBC_ERR_CONN when the
   connection is lost (the app offers to reconnect, issue #407), else
   DBC_ERR_QUERY. */
dbc_status  ifx_failure_status(const dbc_conn *c);
/* Cancel the running call (DBC_FEAT_CANCEL) from another thread. DRDA cannot
   interrupt a query on the connection itself, so this cuts the connection;
   SQLI interrupts the statement. */
dbc_status  ifx_cancel(dbc_conn *c);
/* Bracket a call that talks to the server, so ifx_cancel can reach it. */
void        ifx_busy(dbc_conn *c, int on);

/* --- query.c --- */
dbc_status  ifx_query(dbc_conn *c, const char *sql, dbc_result **out);
/* Execute a statement and wrap its result (shared by metadata.c). */
dbc_status  ifx_run(dbc_conn *c, const char *sql, dbc_result **out);
void        ifx_free_result(dbc_result *r);
int         ifx_col_count(dbc_result *r);
const char *ifx_col_name(dbc_result *r, int col);
dbc_type    ifx_col_type(dbc_result *r, int col);
int         ifx_next_row(dbc_result *r);
const char *ifx_cell_text(dbc_result *r, int col);
long long   ifx_rows_affected(dbc_result *r);

/* Build a synthetic one-row, one-column ("sql") result holding `sql` (shared by
   edit.c and ddl.c to hand generated SQL back to the core). Copies `sql`. */
dbc_status  ifx_make_synthetic_sql(const char *sql, dbc_result **out);

/* --- transactions (DBC_FEAT_TRANSACTIONS) --- */
dbc_status  ifx_begin(dbc_conn *c);
dbc_status  ifx_commit(dbc_conn *c);
dbc_status  ifx_rollback(dbc_conn *c);

/* --- edit.c (DBC_FEAT_DML) --- */
dbc_status  ifx_build_dml(dbc_conn *c, dbc_dml_kind kind,
                          const dbc_dml_row *row, dbc_result **out);

/* --- metadata.c --- */
dbc_status  ifx_list_databases(dbc_conn *c, dbc_result **out);
dbc_status  ifx_list_tables(dbc_conn *c, const char *schema, dbc_result **out);
dbc_status  ifx_describe_table(dbc_conn *c, const char *schema,
                               const char *table, dbc_result **out);
/* Shared catalog helpers (defined in metadata.c). */
int         ifx_is_safe_ident(const char *s);      /* safe unquoted identifier? */
char       *ifx_quote_literal(const char *value);  /* owned '<escaped>' literal  */

/* --- ddl.c (DBC_FEAT_DDL) --- */
/* Reconstruct the CREATE statement of `object` (table or view) as a one-column
   ("sql") result, synthesized from the system catalogs. */
dbc_status  ifx_get_ddl(dbc_conn *c, const char *schema, const char *object,
                        dbc_result **out);

#endif /* QUAERO_INFORMIX_INTERNAL_H */
