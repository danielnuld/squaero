#ifndef QUAERO_INFORMIX_INTERNAL_H
#define QUAERO_INFORMIX_INTERNAL_H

/*
 * Internal definitions shared across the Informix driver translation units.
 * The only public symbol is dbc_driver_entry. The engine is reached through the
 * ODBC Driver Manager (link odbc32; the "IBM INFORMIX ODBC DRIVER" is selected
 * at runtime in the connection string), so no proprietary CSDK library is
 * linked. Vtable functions carry an `ifx_` prefix to stay clear of the ODBC
 * `SQL*` namespace.
 */

#include "dbcore/driver.h"

#include <stddef.h>

/* The Windows ODBC headers (sql.h/sqlext.h) reference Win32 types such as HWND,
   DWORD and GUID, so windows.h must precede them on that platform. */
#if defined(_WIN32)
#  include <windows.h>
#endif

#include <sql.h>
#include <sqlext.h>

/* A live connection: an ODBC environment + connection handle. */
struct dbc_conn {
    SQLHENV env;
    SQLHDBC dbc;
    int     connected;     /* 1 once SQLDriverConnect succeeded */
    char    err[1024];     /* last error (diagnostics or a driver-side reason) */
};

/*
 * A result. Wraps an ODBC statement handle. Column metadata (names, ODBC SQL
 * types) is cached at execute time. Each row is materialized cell-by-cell into
 * per-column owned buffers via SQLGetData(SQL_C_CHAR), so cell_text hands back
 * a stable pointer valid until the next next_row / free_result (the neutral
 * contract). A statement with no result set (INSERT/UPDATE/DDL) carries only
 * `affected`.
 */
struct dbc_result {
    SQLHSTMT   stmt;
    int        ncols;
    char     **col_names;   /* [ncols] owned */
    short     *col_types;   /* [ncols] ODBC SQL type codes */
    char     **cell;        /* [ncols] owned buffers for the current row */
    size_t    *cell_cap;    /* [ncols] capacity of each cell buffer */
    int       *cell_null;   /* [ncols] 1 when the current cell is SQL NULL */
    /* [ncols] lazily-grown buffers holding the UTF-8 form of a cell whose raw
       bytes were not valid UTF-8 (an Informix DB in a Latin-1 code set). The
       neutral contract (and JSON/webview) require UTF-8; see ifx_cell_text. */
    char     **cellu8;
    size_t    *cellu8_cap;
    long long  affected;
    int        has_resultset;

    /* Synthetic one-row result not backed by an ODBC statement: build_dml uses
       it to hand back generated SQL as a single "sql" cell (stmt stays NULL). */
    int        synthetic;
    int        synth_done;   /* cursor state for the synthetic row */
};

/* --- connection.c --- */
dbc_status  ifx_connect(const char *dsn_json, dbc_conn **out);
void        ifx_disconnect(dbc_conn *c);
const char *ifx_last_error(dbc_conn *c);
/* Stash a formatted ODBC diagnostic from handle h (type SQL_HANDLE_*) into the
   connection's error buffer, prefixed with ctx. Shared with query/metadata. */
void        ifx_stash_diag(dbc_conn *c, SQLSMALLINT htype, SQLHANDLE h,
                           const char *ctx);
/* Set a plain driver-side error reason on the connection. */
void        ifx_set_err(dbc_conn *c, const char *msg);

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
   edit.c to hand generated DML back to the core). Copies `sql`. */
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

#endif /* QUAERO_INFORMIX_INTERNAL_H */
