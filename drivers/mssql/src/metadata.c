#include "internal.h"
#include "utils/identifier.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Schema metadata from the sys catalog views, projected to the neutral column
 * convention shared with the other drivers:
 *   list_databases -> name
 *   list_schemas   -> name
 *   list_tables    -> name, type ("table"/"view")
 *   describe_table -> name, type, notnull, dflt_value, pk
 *
 * Like PostgreSQL, SQL Server has schemas within a database (DBC_FEAT_SCHEMAS),
 * and a connection works in one database at a time: list_schemas enumerates the
 * schemas of the current database and ignores `db`, matching the PostgreSQL
 * driver the tree already knows how to present. Names compared in a WHERE go in
 * as N'' literals (utils/identifier.h), so there are no prepared statements.
 */

/* An owned N'' literal of `value`, or NULL on OOM. */
static char *literal(const char *value)
{
    size_t cap = 2 * strlen(value) + 4;
    char *buf = malloc(cap);
    if (buf != NULL && !mssql_quote_literal(value, buf, cap)) {
        free(buf);
        buf = NULL;
    }
    return buf;
}

/* Run `tmpl` with up to two %s filled by `a` and `b`. */
static dbc_status run_format(dbc_conn *c, const char *tmpl, const char *a, const char *b,
                             dbc_result **out)
{
    size_t n = strlen(tmpl) + (a != NULL ? strlen(a) : 0) + (b != NULL ? strlen(b) : 0) + 1;
    char *sql = malloc(n);
    if (sql == NULL) {
        return DBC_ERR_NOMEM;
    }
    snprintf(sql, n, tmpl, a != NULL ? a : "", b != NULL ? b : "");
    dbc_status st = ms_drv_query(c, sql, out);
    free(sql);
    return st;
}

dbc_status ms_drv_list_databases(dbc_conn *c, dbc_result **out)
{
    return ms_drv_query(c,
                        "SELECT name FROM sys.databases "
                        "WHERE HAS_DBACCESS(name) = 1 ORDER BY name",
                        out);
}

dbc_status ms_drv_list_schemas(dbc_conn *c, const char *db, dbc_result **out)
{
    (void)db; /* the current database's schemas; see the note above */
    /* Ids from 16384 are the fixed database-role schemas (db_owner, …). */
    return ms_drv_query(c,
                        "SELECT name FROM sys.schemas "
                        "WHERE schema_id < 16384 "
                        "AND name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') "
                        "ORDER BY name",
                        out);
}

/* The schema filter: an N'' literal of `schema`, or the user's default schema. */
static char *schema_expr(const char *schema)
{
    if (schema == NULL || schema[0] == '\0') {
        char *def = malloc(sizeof "SCHEMA_NAME()");
        if (def != NULL) {
            memcpy(def, "SCHEMA_NAME()", sizeof "SCHEMA_NAME()");
        }
        return def;
    }
    return literal(schema);
}

dbc_status ms_drv_list_tables(dbc_conn *c, const char *schema, dbc_result **out)
{
    char *sch = schema_expr(schema);
    if (sch == NULL) {
        return DBC_ERR_NOMEM;
    }
    dbc_status st = run_format(
        c,
        "SELECT o.name AS name, "
        "CASE o.type WHEN 'V' THEN 'view' ELSE 'table' END AS type "
        "FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id "
        "WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0 AND s.name = %s "
        "ORDER BY type, name",
        sch, NULL, out);
    free(sch);
    return st;
}

dbc_status ms_drv_describe_table(dbc_conn *c, const char *schema, const char *table,
                                 dbc_result **out)
{
    if (table == NULL) {
        return DBC_ERR_PARAM;
    }
    char *tbl = literal(table);
    char *sch = schema_expr(schema);
    if (tbl == NULL || sch == NULL) {
        free(tbl);
        free(sch);
        return DBC_ERR_NOMEM;
    }
    /* The declared type as it would be written in DDL: lengths (in characters for
       the N types, "max" for -1), precision/scale, fractional-second scale. */
    dbc_status st = run_format(
        c,
        "SELECT c.name AS name, "
        "CASE "
        "WHEN ty.name IN ('varchar','char','varbinary','binary') THEN ty.name + '(' + "
        "CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length AS varchar(10)) END + ')' "
        "WHEN ty.name IN ('nvarchar','nchar') THEN ty.name + '(' + "
        "CASE WHEN c.max_length = -1 THEN 'max' ELSE CAST(c.max_length / 2 AS varchar(10)) END + ')' "
        "WHEN ty.name IN ('decimal','numeric') THEN ty.name + '(' + "
        "CAST(c.precision AS varchar(10)) + ',' + CAST(c.scale AS varchar(10)) + ')' "
        "WHEN ty.name IN ('datetime2','time','datetimeoffset') THEN ty.name + '(' + "
        "CAST(c.scale AS varchar(10)) + ')' "
        "ELSE ty.name END AS type, "
        "CASE WHEN c.is_nullable = 1 THEN 0 ELSE 1 END AS notnull, "
        "dc.definition AS dflt_value, "
        "CASE WHEN ic.column_id IS NULL THEN 0 ELSE 1 END AS pk "
        "FROM sys.columns c "
        "JOIN sys.objects o ON o.object_id = c.object_id "
        "JOIN sys.schemas s ON s.schema_id = o.schema_id "
        "JOIN sys.types ty ON ty.user_type_id = c.user_type_id "
        "LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id "
        "LEFT JOIN sys.indexes i ON i.object_id = c.object_id AND i.is_primary_key = 1 "
        "LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id "
        "AND ic.index_id = i.index_id AND ic.column_id = c.column_id "
        "WHERE o.name = %s AND s.name = %s "
        "ORDER BY c.column_id",
        tbl, sch, out);
    free(tbl);
    free(sch);
    return st;
}
