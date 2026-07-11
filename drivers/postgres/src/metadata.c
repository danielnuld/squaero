#include "internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Schema metadata via the system catalogs, projected to the neutral column
 * convention shared with the other drivers:
 *   list_databases -> name
 *   list_schemas   -> name
 *   list_tables    -> name, type ("table"/"view")
 *   describe_table -> name, type, notnull, dflt_value, pk
 *
 * PostgreSQL has real schemas within a database (DBC_FEAT_SCHEMAS), so the tree
 * has a database > schema > object shape. A connection is bound to one database;
 * list_schemas therefore enumerates the schemas of the connected database and
 * ignores its `db` argument (libpq cannot switch databases on a live handle).
 *
 * Values that go into a WHERE/= comparison are escaped with PQescapeLiteral and
 * inlined, so the buffered result path (pg_drv_run_stored) is reused without
 * prepared statements.
 */

/* Owned `'<escaped>'` SQL literal for `value` (PQescapeLiteral already adds the
   quotes and any needed E'' prefix), or NULL on error. Free with free(). */
static char *escape_quoted(PGconn *conn, const char *value)
{
    char *lit = PQescapeLiteral(conn, value, strlen(value));
    if (lit == NULL) {
        return NULL;
    }
    size_t n = strlen(lit) + 1;
    char *copy = malloc(n);
    if (copy != NULL) {
        memcpy(copy, lit, n);
    }
    PQfreemem(lit);
    return copy;
}

/* Build `<before><middle><after>` into an owned buffer, or NULL on OOM. */
static char *build_sql(const char *before, const char *middle, const char *after)
{
    size_t n = strlen(before) + strlen(middle) + strlen(after) + 1;
    char *sql = malloc(n);
    if (sql == NULL) {
        return NULL;
    }
    snprintf(sql, n, "%s%s%s", before, middle, after);
    return sql;
}

dbc_status pg_drv_list_databases(dbc_conn *c, dbc_result **out)
{
    return pg_drv_run_stored(
        c,
        "SELECT datname AS name FROM pg_database "
        "WHERE datistemplate = false AND datallowconn ORDER BY datname",
        out);
}

dbc_status pg_drv_list_schemas(dbc_conn *c, const char *db, dbc_result **out)
{
    (void)db;  /* a connection is bound to one database; list its schemas */
    return pg_drv_run_stored(
        c,
        "SELECT nspname AS name FROM pg_namespace "
        "WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' "
        "ORDER BY nspname",
        out);
}

dbc_status pg_drv_list_tables(dbc_conn *c, const char *schema, dbc_result **out)
{
    char *literal = NULL;
    if (schema != NULL && schema[0] != '\0') {
        literal = escape_quoted(c->conn, schema);
        if (literal == NULL) {
            return DBC_ERR_NOMEM;
        }
    }
    /* relkind: r=table, p=partitioned table, v=view, m=materialized view. */
    char *sql = build_sql(
        "SELECT c.relname AS name, "
        "CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END AS type "
        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE c.relkind IN ('r','p','v','m') AND n.nspname = ",
        literal != NULL ? literal : "current_schema()",
        " ORDER BY type, name");
    free(literal);
    if (sql == NULL) {
        return DBC_ERR_NOMEM;
    }
    dbc_status st = pg_drv_run_stored(c, sql, out);
    free(sql);
    return st;
}

dbc_status pg_drv_describe_table(dbc_conn *c, const char *schema,
                                 const char *table, dbc_result **out)
{
    char *table_lit = escape_quoted(c->conn, table);
    if (table_lit == NULL) {
        return DBC_ERR_NOMEM;
    }

    /* Restrict to the given schema, or current_schema() when none was supplied. */
    char *schema_expr = NULL;  /* owned only when a literal is built */
    const char *schema_clause = "current_schema()";
    if (schema != NULL && schema[0] != '\0') {
        schema_expr = escape_quoted(c->conn, schema);
        if (schema_expr == NULL) {
            free(table_lit);
            return DBC_ERR_NOMEM;
        }
        schema_clause = schema_expr;
    }

    /* Columns with their declared type, NOT NULL flag, default expression and
       whether they take part in the primary key — the neutral describe shape. */
    static const char *tmpl =
        "SELECT a.attname AS name, "
        "format_type(a.atttypid, a.atttypmod) AS type, "
        "CASE WHEN a.attnotnull THEN 1 ELSE 0 END AS notnull, "
        "pg_get_expr(d.adbin, d.adrelid) AS dflt_value, "
        "CASE WHEN pk.attnum IS NOT NULL THEN 1 ELSE 0 END AS pk "
        "FROM pg_attribute a "
        "JOIN pg_class t ON t.oid = a.attrelid "
        "JOIN pg_namespace n ON n.oid = t.relnamespace "
        "LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum "
        "LEFT JOIN (SELECT conrelid, unnest(conkey) AS attnum FROM pg_constraint "
        "WHERE contype = 'p') pk ON pk.conrelid = a.attrelid AND pk.attnum = a.attnum "
        "WHERE t.relname = %s AND n.nspname = %s "
        "AND a.attnum > 0 AND NOT a.attisdropped "
        "ORDER BY a.attnum";

    size_t n = strlen(tmpl) + strlen(table_lit) + strlen(schema_clause) + 1;
    char *sql = malloc(n);
    if (sql == NULL) {
        free(table_lit);
        free(schema_expr);
        return DBC_ERR_NOMEM;
    }
    snprintf(sql, n, tmpl, table_lit, schema_clause);
    free(table_lit);
    free(schema_expr);

    dbc_status st = pg_drv_run_stored(c, sql, out);
    free(sql);
    return st;
}
