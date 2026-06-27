#include "internal.h"
#include "utils/identifier.h"

#include <stdio.h>
#include <stdlib.h>

/*
 * Schema metadata: databases, tables/views and a table's column structure.
 * Each method prepares a SELECT/PRAGMA into a dbc_result and hands it back
 * un-stepped — the core drains it through the same col_count/next_row/cell_text
 * accessors used for ordinary queries, so there is no separate result machinery.
 *
 * Identifiers that cannot be bound (a schema qualifier on sqlite_master) are
 * quoted via sqlite_quote_identifier; values that can be bound (table names)
 * travel as bound parameters, never concatenated into SQL.
 */

dbc_status sqlite_prepare_result(dbc_conn *c, const char *sql, const char *arg,
                                 dbc_result **out)
{
    *out = NULL;

    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        return DBC_ERR_NOMEM;
    }

    int rc = sqlite3_prepare_v2(c->db, sql, -1, &r->stmt, NULL);
    if (rc != SQLITE_OK || r->stmt == NULL) {
        sqlite3_finalize(r->stmt);  /* finalize(NULL) is a documented no-op */
        free(r);
        return DBC_ERR_QUERY;
    }

    if (arg != NULL) {
        rc = sqlite3_bind_text(r->stmt, 1, arg, -1, SQLITE_TRANSIENT);
        if (rc != SQLITE_OK) {
            sqlite3_finalize(r->stmt);
            free(r);
            return DBC_ERR_QUERY;
        }
    }

    r->col_count = sqlite3_column_count(r->stmt);
    *out = r;
    return DBC_OK;
}

dbc_status sqlite_list_databases(dbc_conn *c, dbc_result **out)
{
    return sqlite_prepare_result(
        c, "SELECT name FROM pragma_database_list ORDER BY seq", NULL, out);
}

dbc_status sqlite_list_tables(dbc_conn *c, const char *schema, dbc_result **out)
{
    /* `schema` is a SQLite database name (main / temp / an attached db). */
    const char *db = (schema != NULL && schema[0] != '\0') ? schema : "main";

    /* The db name cannot be a bound parameter (it qualifies a table name), so
       it is quoted. qid is 256 bytes; the SQL template below is ~90, so the
       512-byte buffer cannot overflow. */
    char qid[256];
    if (!sqlite_quote_identifier(db, qid, sizeof qid)) {
        snprintf(c->err, sizeof c->err, "database name too long");
        return DBC_ERR_PARAM;
    }

    char sql[512];
    snprintf(sql, sizeof sql,
             "SELECT name, type FROM %s.sqlite_master "
             "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%%' "
             "ORDER BY type, name",
             qid);
    return sqlite_prepare_result(c, sql, NULL, out);
}

dbc_status sqlite_describe_table(dbc_conn *c, const char *table, dbc_result **out)
{
    /* pragma_table_info(?1): one row per column with name, declared type,
       NOT NULL flag, default expression and primary-key position. */
    return sqlite_prepare_result(
        c,
        "SELECT name, type, \"notnull\", dflt_value, pk "
        "FROM pragma_table_info(?1)",
        table, out);
}
