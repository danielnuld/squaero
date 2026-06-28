#include "internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Schema metadata via information_schema, projected to the neutral column
 * convention shared with the SQLite driver:
 *   list_databases -> name
 *   list_tables    -> name, type ("table"/"view")
 *   describe_table -> name, type, notnull, dflt_value, pk
 *
 * Values that go into a WHERE comparison are escaped with mysql_real_escape_
 * string and inlined as string literals, so the buffered text-protocol result
 * path (mysql_drv_run_stored) is reused without prepared statements.
 */

/* Returns an owned `'<escaped>'` SQL string literal, or NULL on OOM. */
static char *escape_quoted(MYSQL *db, const char *value)
{
    size_t len = strlen(value);
    char *esc = malloc(2 * len + 1);
    if (esc == NULL) {
        return NULL;
    }
    unsigned long n = mysql_real_escape_string(db, esc, value, (unsigned long)len);

    char *quoted = malloc((size_t)n + 3);
    if (quoted == NULL) {
        free(esc);
        return NULL;
    }
    quoted[0] = '\'';
    memcpy(quoted + 1, esc, n);
    quoted[n + 1] = '\'';
    quoted[n + 2] = '\0';
    free(esc);
    return quoted;
}

/* Build `<before><literal><after>` into an owned buffer, or NULL on OOM. */
static char *build_sql(const char *before, const char *literal, const char *after)
{
    size_t n = strlen(before) + strlen(literal) + strlen(after) + 1;
    char *sql = malloc(n);
    if (sql == NULL) {
        return NULL;
    }
    snprintf(sql, n, "%s%s%s", before, literal, after);
    return sql;
}

dbc_status mysql_drv_list_databases(dbc_conn *c, dbc_result **out)
{
    return mysql_drv_run_stored(
        c,
        "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA "
        "ORDER BY SCHEMA_NAME",
        out);
}

dbc_status mysql_drv_list_tables(dbc_conn *c, const char *schema, dbc_result **out)
{
    char *literal = NULL;
    if (schema != NULL && schema[0] != '\0') {
        literal = escape_quoted(c->db, schema);
        if (literal == NULL) {
            return DBC_ERR_NOMEM;
        }
    }
    char *sql = build_sql(
        "SELECT TABLE_NAME AS name, "
        "IF(TABLE_TYPE='VIEW','view','table') AS type "
        "FROM information_schema.TABLES WHERE TABLE_SCHEMA = ",
        literal != NULL ? literal : "DATABASE()",
        " ORDER BY type, name");
    free(literal);
    if (sql == NULL) {
        return DBC_ERR_NOMEM;
    }
    dbc_status st = mysql_drv_run_stored(c, sql, out);
    free(sql);
    return st;
}

dbc_status mysql_drv_describe_table(dbc_conn *c, const char *schema,
                                    const char *table, dbc_result **out)
{
    char *table_lit = escape_quoted(c->db, table);
    if (table_lit == NULL) {
        return DBC_ERR_NOMEM;
    }

    /* Restrict to the given database (a MySQL "schema"), or DATABASE() when
       none was supplied. */
    char *schema_expr = NULL;  /* owned only when a literal is built */
    const char *schema_clause = "DATABASE()";
    if (schema != NULL && schema[0] != '\0') {
        schema_expr = escape_quoted(c->db, schema);
        if (schema_expr == NULL) {
            free(table_lit);
            return DBC_ERR_NOMEM;
        }
        schema_clause = schema_expr;
    }

    /* "SELECT ... WHERE TABLE_SCHEMA = <schema_clause> AND TABLE_NAME = <table_lit> ..." */
    size_t n = strlen(
                   "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, "
                   "IF(IS_NULLABLE='NO',1,0) AS `notnull`, COLUMN_DEFAULT AS dflt_value, "
                   "IF(COLUMN_KEY='PRI',1,0) AS pk "
                   "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = "
                   " AND TABLE_NAME =  ORDER BY ORDINAL_POSITION") +
               strlen(schema_clause) + strlen(table_lit) + 1;
    char *sql = malloc(n);
    if (sql == NULL) {
        free(table_lit);
        free(schema_expr);
        return DBC_ERR_NOMEM;
    }
    snprintf(sql, n,
             "SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, "
             "IF(IS_NULLABLE='NO',1,0) AS `notnull`, COLUMN_DEFAULT AS dflt_value, "
             "IF(COLUMN_KEY='PRI',1,0) AS pk "
             "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = %s"
             " AND TABLE_NAME = %s ORDER BY ORDINAL_POSITION",
             schema_clause, table_lit);
    free(table_lit);
    free(schema_expr);

    dbc_status st = mysql_drv_run_stored(c, sql, out);
    free(sql);
    return st;
}
