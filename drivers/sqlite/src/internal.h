#ifndef QUAERO_SQLITE_INTERNAL_H
#define QUAERO_SQLITE_INTERNAL_H

/*
 * Internal definitions shared across the SQLite driver translation units. Not
 * part of any public surface — the only public symbol is dbc_driver_entry.
 */

#include "dbcore/driver.h"

#include "sqlite3.h"

/* A live SQLite connection. The driver owns this concrete shape; the core only
   holds an opaque dbc_conn pointer. */
struct dbc_conn {
    sqlite3 *db;
    char     err[256];  /* reason for errors with no live db to query */
};

/* A prepared statement plus the bookkeeping the result accessors need. */
struct dbc_result {
    sqlite3_stmt *stmt;          /* NULL for an empty/no-op statement */
    int           col_count;
    long long     rows_affected; /* meaningful for non-SELECT statements */
};

/* --- connection.c --- */
dbc_status   sqlite_connect(const char *dsn_json, dbc_conn **out);
void         sqlite_disconnect(dbc_conn *c);
const char  *sqlite_last_error(dbc_conn *c);

/* --- query.c --- */
dbc_status   sqlite_query(dbc_conn *c, const char *sql, dbc_result **out);
void         sqlite_free_result(dbc_result *r);
int          sqlite_col_count(dbc_result *r);
const char  *sqlite_col_name(dbc_result *r, int col);
dbc_type     sqlite_col_type(dbc_result *r, int col);
int          sqlite_next_row(dbc_result *r);
const char  *sqlite_cell_text(dbc_result *r, int col);
long long    sqlite_rows_affected(dbc_result *r);

/* --- metadata.c (DBC_FEAT_INTROSPECTION) --- */
/* Prepare a result-set statement and wrap it as a dbc_result without stepping;
   `arg`, when non-NULL, is bound to ?1 as text. Shared by metadata.c/ddl.c. */
dbc_status   sqlite_prepare_result(dbc_conn *c, const char *sql, const char *arg,
                                   dbc_result **out);
dbc_status   sqlite_list_databases(dbc_conn *c, dbc_result **out);
dbc_status   sqlite_list_tables(dbc_conn *c, const char *schema, dbc_result **out);
dbc_status   sqlite_describe_table(dbc_conn *c, const char *table, dbc_result **out);

/* --- ddl.c (DBC_FEAT_DDL) --- */
dbc_status   sqlite_get_ddl(dbc_conn *c, const char *object, dbc_result **out);

#endif /* QUAERO_SQLITE_INTERNAL_H */
