#ifndef QUAERO_MSSQL_INTERNAL_H
#define QUAERO_MSSQL_INTERNAL_H

/*
 * Internal definitions shared across the SQL Server driver translation units.
 * The only public symbol is dbc_driver_entry. Vtable functions carry an
 * `ms_drv_` prefix so they never collide with FreeTDS's own `db*` / `tds_*`
 * symbols, which are linked statically into the same plugin.
 */

#include "dbcore/driver.h"

#ifdef QUAERO_MSSQL_TDSWIRE
/* On libtdswire, our own TDS client (issue #584): tw_connection.c and
   tw_query.c replace connection.c and query.c. */
#include "tdswire.h"

struct dbc_conn {
    tw_conn *tw;
    char     err[1024];  /* the reason when there is no connection to ask */
};
#else
#include <sybfront.h>
#include <sybdb.h>

/* A live connection. The core only holds an opaque dbc_conn pointer. db-lib's
   error and message handlers find this struct through dbsetuserdata. */
struct dbc_conn {
    DBPROCESS *dbproc;
    char       err[1024];  /* last error or server message on this connection */
};
#endif

/*
 * A result, buffered whole: db-lib streams rows, but a DBPROCESS cannot run the
 * next statement while rows are pending, and the core may run another statement
 * before it has read this result to the end. `cells` holds nrows*ncols owned
 * strings (NULL = SQL NULL). For a statement with no result set only `affected`
 * is meaningful.
 *
 * ponytail: the whole result set lives in memory; stream through a dedicated
 * DBPROCESS if a huge SELECT ever makes that bite.
 */
struct dbc_result {
    int        ncols;
    char     **names;      /* ncols owned column names */
    int       *types;      /* ncols db-lib column types */
    long long  nrows;
    long long  cap_rows;
    char     **cells;      /* nrows * ncols, row-major */
    long long  row;        /* current row; -1 before the first next_row */
    long long  affected;
};

/* --- connection.c --- */
dbc_status   ms_drv_connect(const char *dsn_json, dbc_conn **out);
void         ms_drv_disconnect(dbc_conn *c);
const char  *ms_drv_last_error(dbc_conn *c);
#ifdef QUAERO_MSSQL_TDSWIRE
/* Cancel the running batch with an ATTENTION (DBC_FEAT_CANCEL), from any thread. */
dbc_status   ms_drv_cancel(dbc_conn *c);
#endif

/* --- query.c --- */
dbc_status   ms_drv_query(dbc_conn *c, const char *sql, dbc_result **out);
void         ms_drv_free_result(dbc_result *r);
int          ms_drv_col_count(dbc_result *r);
const char  *ms_drv_col_name(dbc_result *r, int col);
dbc_type     ms_drv_col_type(dbc_result *r, int col);
int          ms_drv_next_row(dbc_result *r);
const char  *ms_drv_cell_text(dbc_result *r, int col);
long long    ms_drv_rows_affected(dbc_result *r);

/* --- transactions (DBC_FEAT_TRANSACTIONS) --- */
dbc_status   ms_drv_begin(dbc_conn *c);
dbc_status   ms_drv_commit(dbc_conn *c);
dbc_status   ms_drv_rollback(dbc_conn *c);

/* --- metadata.c --- */
dbc_status   ms_drv_list_databases(dbc_conn *c, dbc_result **out);
dbc_status   ms_drv_list_schemas(dbc_conn *c, const char *db, dbc_result **out);
dbc_status   ms_drv_list_tables(dbc_conn *c, const char *schema, dbc_result **out);
dbc_status   ms_drv_describe_table(dbc_conn *c, const char *schema,
                                   const char *table, dbc_result **out);

#endif /* QUAERO_MSSQL_INTERNAL_H */
