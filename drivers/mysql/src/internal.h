#ifndef QUAERO_MYSQL_INTERNAL_H
#define QUAERO_MYSQL_INTERNAL_H

/*
 * Internal definitions shared across the MySQL/MariaDB driver translation
 * units. The only public symbol is dbc_driver_entry. Vtable functions carry a
 * `mysql_drv_` prefix so they never collide with the client library's own
 * `mysql_*` symbols.
 */

#include "dbcore/driver.h"

#include <mysql.h>

/* A live connection. The core only holds an opaque dbc_conn pointer. */
struct dbc_conn {
    MYSQL *db;
    char   err[512];  /* stashed reason when there is no usable db to query */
};

/*
 * A result. For an ordinary query it wraps a buffered MYSQL_RES (mysql_store_
 * result); for a non-result statement only `affected` is meaningful. get_ddl
 * produces a "synthetic" single-column ("sql") result holding one owned string,
 * so the engine's two-column SHOW CREATE is normalized to the neutral contract.
 */
struct dbc_result {
    MYSQL_RES   *res;          /* NULL for no-result-set or synthetic */
    MYSQL_FIELD *fields;       /* column metadata (borrowed from res) */
    MYSQL_ROW    row;          /* current row from mysql_fetch_row */
    unsigned int field_count;
    long long    affected;

    int   synthetic;           /* 1 => single "sql" column from synth_sql */
    char *synth_sql;           /* owned DDL string, or NULL (=> zero rows) */
    int   synth_done;          /* cursor state for the synthetic row */
};

/* --- connection.c --- */
dbc_status   mysql_drv_connect(const char *dsn_json, dbc_conn **out);
void         mysql_drv_disconnect(dbc_conn *c);
const char  *mysql_drv_last_error(dbc_conn *c);

/* --- query.c --- */
dbc_status   mysql_drv_query(dbc_conn *c, const char *sql, dbc_result **out);
/* Run a text statement and wrap its buffered result (shared by metadata.c). */
dbc_status   mysql_drv_run_stored(dbc_conn *c, const char *sql, dbc_result **out);
void         mysql_drv_free_result(dbc_result *r);
int          mysql_drv_col_count(dbc_result *r);
const char  *mysql_drv_col_name(dbc_result *r, int col);
dbc_type     mysql_drv_col_type(dbc_result *r, int col);
int          mysql_drv_next_row(dbc_result *r);
const char  *mysql_drv_cell_text(dbc_result *r, int col);
long long    mysql_drv_rows_affected(dbc_result *r);

/* --- metadata.c --- */
dbc_status   mysql_drv_list_databases(dbc_conn *c, dbc_result **out);
dbc_status   mysql_drv_list_tables(dbc_conn *c, const char *schema, dbc_result **out);
dbc_status   mysql_drv_describe_table(dbc_conn *c, const char *table, dbc_result **out);

/* --- ddl.c --- */
dbc_status   mysql_drv_get_ddl(dbc_conn *c, const char *object, dbc_result **out);

#endif /* QUAERO_MYSQL_INTERNAL_H */
