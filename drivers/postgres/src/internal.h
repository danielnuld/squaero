#ifndef QUAERO_POSTGRES_INTERNAL_H
#define QUAERO_POSTGRES_INTERNAL_H

/*
 * Internal definitions shared across the PostgreSQL driver translation units.
 * The only public symbol is dbc_driver_entry. Vtable functions carry a
 * `pg_drv_` prefix so they never collide with libpq's own `PQ*` / `pg_*`
 * symbols.
 */

#include "dbcore/driver.h"

#include <libpq-fe.h>

/* A live connection. The core only holds an opaque dbc_conn pointer. */
struct dbc_conn {
    PGconn   *conn;
    PGcancel *cancel;      /* obtained at connect; usable from another thread */
    char      err[512];    /* stashed reason when there is no usable conn to query */
};

/*
 * A result. For an ordinary query it wraps a buffered PGresult (libpq buffers
 * the whole result set client-side), iterated by row index. For a non-result
 * statement only `affected` is meaningful. get_ddl / build_dml produce a
 * "synthetic" single-column ("sql") result holding one owned string, so the
 * neutral one-column contract is honored without a server round-trip shape.
 */
struct dbc_result {
    PGresult *res;         /* NULL for no-result-set or synthetic */
    int       nrows;
    int       ncols;
    int       row;         /* current row index; -1 before the first next_row */
    long long affected;

    int   synthetic;       /* 1 => single "sql" column from synth_sql */
    char *synth_sql;       /* owned DDL/DML string, or NULL (=> zero rows) */
    int   synth_done;      /* cursor state for the synthetic row */
};

/* --- connection.c --- */
dbc_status   pg_drv_connect(const char *dsn_json, dbc_conn **out);
void         pg_drv_disconnect(dbc_conn *c);
const char  *pg_drv_last_error(dbc_conn *c);
/* Cancel the running query (DBC_FEAT_CANCEL). Thread-safe: uses the PGcancel
   object captured at connect, never touching c->conn (used by the worker). */
dbc_status   pg_drv_cancel(dbc_conn *c);

/* --- query.c --- */
dbc_status   pg_drv_query(dbc_conn *c, const char *sql, dbc_result **out);
/* Run a text statement and wrap its buffered result (shared by metadata.c). */
dbc_status   pg_drv_run_stored(dbc_conn *c, const char *sql, dbc_result **out);
void         pg_drv_free_result(dbc_result *r);
int          pg_drv_col_count(dbc_result *r);
const char  *pg_drv_col_name(dbc_result *r, int col);
dbc_type     pg_drv_col_type(dbc_result *r, int col);
int          pg_drv_next_row(dbc_result *r);
const char  *pg_drv_cell_text(dbc_result *r, int col);
long long    pg_drv_rows_affected(dbc_result *r);

/* Wrap an owned SQL string as a synthetic one-column ("sql") result (shared by
   ddl.c and edit.c). Takes ownership of `sql`; frees it on failure. */
dbc_status   pg_drv_make_synthetic(char *sql, dbc_result **out);

/* --- transactions (DBC_FEAT_TRANSACTIONS) --- */
dbc_status   pg_drv_begin(dbc_conn *c);
dbc_status   pg_drv_commit(dbc_conn *c);
dbc_status   pg_drv_rollback(dbc_conn *c);

/* --- metadata.c --- */
dbc_status   pg_drv_list_databases(dbc_conn *c, dbc_result **out);
dbc_status   pg_drv_list_schemas(dbc_conn *c, const char *db, dbc_result **out);
dbc_status   pg_drv_list_tables(dbc_conn *c, const char *schema, dbc_result **out);
dbc_status   pg_drv_describe_table(dbc_conn *c, const char *schema,
                                   const char *table, dbc_result **out);

/* --- ddl.c --- */
dbc_status   pg_drv_get_ddl(dbc_conn *c, const char *schema, const char *object,
                            dbc_result **out);

/* --- edit.c (DBC_FEAT_DML) --- */
dbc_status   pg_drv_build_dml(dbc_conn *c, dbc_dml_kind kind,
                              const dbc_dml_row *row, dbc_result **out);

#endif /* QUAERO_POSTGRES_INTERNAL_H */
