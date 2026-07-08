#include "internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Schema metadata via the Informix system catalogs, projected to the neutral
 * column convention shared with the other drivers:
 *   list_databases -> name
 *   list_tables    -> name, type ("table"/"view")
 *   describe_table -> name, type, notnull, dflt_value, pk
 *
 * The connection is bound to one database, but the catalogs of another database
 * on the same server can be reached with the `db:table` qualifier, so a `schema`
 * argument (the database name, since Informix exposes no separate schema layer)
 * is validated as a plain identifier and used as that qualifier. The table name
 * in describe_table is inlined as an escaped string literal. Type rendering from
 * syscolumns.coltype covers the base types; declared length/precision and
 * primary-key/default detection are intentionally simplified in this first cut.
 */

/* True if s is a safe Informix identifier (used unquoted as a db qualifier). */
static int is_safe_ident(const char *s)
{
    if (s == NULL || s[0] == '\0' || strlen(s) >= 128) {
        return 0;
    }
    if (!((s[0] >= 'A' && s[0] <= 'Z') || (s[0] >= 'a' && s[0] <= 'z') ||
          s[0] == '_')) {
        return 0;
    }
    for (const char *p = s; *p != '\0'; p++) {
        char ch = *p;
        if (!((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
              (ch >= '0' && ch <= '9') || ch == '_')) {
            return 0;
        }
    }
    return 1;
}

/* Owned `'<escaped>'` SQL string literal (single quotes doubled), or NULL OOM. */
static char *quote_literal(const char *value)
{
    size_t extra = 0;
    for (const char *p = value; *p != '\0'; p++) {
        if (*p == '\'') {
            extra++;
        }
    }
    size_t len = strlen(value);
    char *out = malloc(len + extra + 3);  /* quotes + NUL */
    if (out == NULL) {
        return NULL;
    }
    size_t i = 0;
    out[i++] = '\'';
    for (const char *p = value; *p != '\0'; p++) {
        if (*p == '\'') {
            out[i++] = '\'';
        }
        out[i++] = *p;
    }
    out[i++] = '\'';
    out[i] = '\0';
    return out;
}

dbc_status ifx_list_databases(dbc_conn *c, dbc_result **out)
{
    return ifx_run(c,
                   "SELECT TRIM(name) AS name FROM sysmaster:sysdatabases "
                   "ORDER BY name",
                   out);
}

dbc_status ifx_list_tables(dbc_conn *c, const char *schema, dbc_result **out)
{
    /* Optional `db:` qualifier so a different database on the server can be
       listed; rejected unless it is a plain identifier. */
    char qualifier[160] = "";
    if (schema != NULL && schema[0] != '\0') {
        if (!is_safe_ident(schema)) {
            ifx_set_err(c, "database name is not a valid identifier");
            return DBC_ERR_PARAM;
        }
        snprintf(qualifier, sizeof qualifier, "%s:", schema);
    }

    char sql[512];
    snprintf(sql, sizeof sql,
             "SELECT TRIM(tabname) AS name, "
             "CASE WHEN tabtype = 'V' THEN 'view' ELSE 'table' END AS type "
             "FROM %ssystables WHERE tabid > 99 AND tabtype IN ('T','V') "
             "ORDER BY 2, 1",
             qualifier);
    return ifx_run(c, sql, out);
}

dbc_status ifx_describe_table(dbc_conn *c, const char *schema,
                              const char *table, dbc_result **out)
{
    if (table == NULL || table[0] == '\0') {
        ifx_set_err(c, "table name is required");
        return DBC_ERR_PARAM;
    }

    char qualifier[160] = "";
    if (schema != NULL && schema[0] != '\0') {
        if (!is_safe_ident(schema)) {
            ifx_set_err(c, "database name is not a valid identifier");
            return DBC_ERR_PARAM;
        }
        snprintf(qualifier, sizeof qualifier, "%s:", schema);
    }

    char *table_lit = quote_literal(table);
    if (table_lit == NULL) {
        return DBC_ERR_NOMEM;
    }

    /* coltype: low byte is the base type, bit 0x100 (256) is the NOT NULL flag.
       Render the base type name; length/precision are omitted in this cut.
       NOTE: use MOD() for the base type, NOT `coltype - (coltype/256)*256` —
       Informix `/` is non-truncating (257/256 = 1.0039…), so that arithmetic
       collapses to 0 for every column and mis-reports all types as CHAR. */
    static const char *const k_select =
        "SELECT TRIM(c.colname) AS name, "
        "CASE MOD(c.coltype, 256) "
        "WHEN 0 THEN 'CHAR' WHEN 1 THEN 'SMALLINT' WHEN 2 THEN 'INTEGER' "
        "WHEN 3 THEN 'FLOAT' WHEN 4 THEN 'SMALLFLOAT' WHEN 5 THEN 'DECIMAL' "
        "WHEN 6 THEN 'SERIAL' WHEN 7 THEN 'DATE' WHEN 8 THEN 'MONEY' "
        "WHEN 10 THEN 'DATETIME' WHEN 11 THEN 'BYTE' WHEN 12 THEN 'TEXT' "
        "WHEN 13 THEN 'VARCHAR' WHEN 14 THEN 'INTERVAL' WHEN 15 THEN 'NCHAR' "
        "WHEN 16 THEN 'NVARCHAR' WHEN 17 THEN 'INT8' WHEN 18 THEN 'SERIAL8' "
        "WHEN 40 THEN 'LVARCHAR' WHEN 41 THEN 'UDT' WHEN 43 THEN 'LVARCHAR' "
        "WHEN 45 THEN 'BOOLEAN' WHEN 52 THEN 'BIGINT' WHEN 53 THEN 'BIGSERIAL' "
        "ELSE 'OTHER' END AS type, "
        "CASE WHEN BITAND(c.coltype, 256) = 256 THEN 1 ELSE 0 END AS notnull, "
        "CAST(NULL AS VARCHAR(255)) AS dflt_value, 0 AS pk "
        "FROM %ssyscolumns c, %ssystables t "
        "WHERE t.tabname = %s AND t.tabid = c.tabid ORDER BY c.colno";

    size_t n = strlen(k_select) + 2 * strlen(qualifier) + strlen(table_lit) + 1;
    char *sql = malloc(n);
    if (sql == NULL) {
        free(table_lit);
        return DBC_ERR_NOMEM;
    }
    snprintf(sql, n, k_select, qualifier, qualifier, table_lit);
    free(table_lit);

    dbc_status st = ifx_run(c, sql, out);
    free(sql);
    return st;
}
