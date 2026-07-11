#include "internal.h"
#include "utils/identifier.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * DDL generation. PostgreSQL has no SHOW CREATE TABLE, so the driver reconstructs
 * a CREATE TABLE statement from the catalog: one line per column (declared type,
 * NOT NULL, DEFAULT) plus a PRIMARY KEY clause when present. This covers the
 * common case honestly; it deliberately does not reproduce every object detail
 * (foreign keys, checks, indexes, sequences owned by serial columns), which the
 * neutral get_ddl contract does not require. The result is returned as a
 * synthetic single-column ("sql") result, like the other drivers.
 */

/* A small growable string; `oom` latches an allocation failure. */
typedef struct {
    char  *data;
    size_t len;
    size_t cap;
    int    oom;
} dstr;

static void ds_puts(dstr *b, const char *s)
{
    if (b->oom || s == NULL) {
        return;
    }
    size_t add = strlen(s);
    if (b->len + add + 1 > b->cap) {
        size_t cap = b->cap == 0 ? 256 : b->cap;
        while (cap < b->len + add + 1) {
            cap *= 2;
        }
        char *grown = realloc(b->data, cap);
        if (grown == NULL) {
            b->oom = 1;
            return;
        }
        b->data = grown;
        b->cap = cap;
    }
    memcpy(b->data + b->len, s, add);
    b->len += add;
    b->data[b->len] = '\0';
}

/* Append `id` double-quoted, or set oom on an over-long identifier. */
static void ds_ident(dstr *b, const char *id)
{
    char q[512];
    if (!pg_quote_identifier(id, q, sizeof q)) {
        b->oom = 1;
        return;
    }
    ds_puts(b, q);
}

/* Effective schema literal for the catalog lookups: the given schema quoted as a
   value, or current_schema(). Returns an owned string, or NULL on OOM. */
static char *schema_value(PGconn *conn, const char *schema)
{
    if (schema == NULL || schema[0] == '\0') {
        char *s = malloc(sizeof "current_schema()");
        if (s != NULL) {
            memcpy(s, "current_schema()", sizeof "current_schema()");
        }
        return s;
    }
    char *lit = PQescapeLiteral(conn, schema, strlen(schema));
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

dbc_status pg_drv_get_ddl(dbc_conn *c, const char *schema, const char *object,
                          dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->conn == NULL) {
        return DBC_ERR_PARAM;
    }

    char *obj_lit = PQescapeLiteral(c->conn, object, strlen(object));
    char *sch_val = schema_value(c->conn, schema);
    if (obj_lit == NULL || sch_val == NULL) {
        if (obj_lit != NULL) {
            PQfreemem(obj_lit);
        }
        free(sch_val);
        return DBC_ERR_NOMEM;
    }

    /* Columns, ordered as declared. nspname comes back so the CREATE header uses
       the object's real (possibly resolved) schema. */
    static const char *cols_tmpl =
        "SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, "
        "pg_get_expr(d.adbin, d.adrelid), n.nspname "
        "FROM pg_attribute a "
        "JOIN pg_class t ON t.oid = a.attrelid "
        "JOIN pg_namespace n ON n.oid = t.relnamespace "
        "LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum "
        "WHERE t.relname = %s AND n.nspname = %s "
        "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum";
    size_t cn = strlen(cols_tmpl) + strlen(obj_lit) + strlen(sch_val) + 1;
    char *cols_sql = malloc(cn);
    if (cols_sql == NULL) {
        PQfreemem(obj_lit);
        free(sch_val);
        return DBC_ERR_NOMEM;
    }
    snprintf(cols_sql, cn, cols_tmpl, obj_lit, sch_val);
    PGresult *cols = PQexec(c->conn, cols_sql);
    free(cols_sql);

    if (cols == NULL || PQresultStatus(cols) != PGRES_TUPLES_OK) {
        if (cols != NULL) {
            PQclear(cols);
        }
        PQfreemem(obj_lit);
        free(sch_val);
        return DBC_ERR_QUERY;
    }
    if (PQntuples(cols) == 0) {
        /* No such table/view in the schema; report it rather than a blank DDL. */
        PQclear(cols);
        PQfreemem(obj_lit);
        free(sch_val);
        return DBC_ERR_QUERY;
    }

    /* Primary-key columns, in key order. */
    static const char *pk_tmpl =
        "SELECT a.attname FROM pg_constraint con "
        "JOIN pg_class t ON t.oid = con.conrelid "
        "JOIN pg_namespace n ON n.oid = t.relnamespace "
        "JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true "
        "JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum "
        "WHERE con.contype = 'p' AND t.relname = %s AND n.nspname = %s "
        "ORDER BY k.ord";
    size_t pn = strlen(pk_tmpl) + strlen(obj_lit) + strlen(sch_val) + 1;
    char *pk_sql = malloc(pn);
    PGresult *pk = NULL;
    if (pk_sql != NULL) {
        snprintf(pk_sql, pn, pk_tmpl, obj_lit, sch_val);
        pk = PQexec(c->conn, pk_sql);
        free(pk_sql);
    }
    PQfreemem(obj_lit);
    free(sch_val);

    /* Build the statement. */
    dstr b = {0};
    const char *hdr_schema = PQgetvalue(cols, 0, 4);  /* real nspname */
    ds_puts(&b, "CREATE TABLE ");
    if (hdr_schema != NULL && hdr_schema[0] != '\0') {
        ds_ident(&b, hdr_schema);
        ds_puts(&b, ".");
    }
    ds_ident(&b, object);
    ds_puts(&b, " (\n");

    int ncols = PQntuples(cols);
    for (int i = 0; i < ncols; i++) {
        ds_puts(&b, "    ");
        ds_ident(&b, PQgetvalue(cols, i, 0));
        ds_puts(&b, " ");
        ds_puts(&b, PQgetvalue(cols, i, 1));  /* format_type: already valid SQL */
        if (strcmp(PQgetvalue(cols, i, 2), "t") == 0) {
            ds_puts(&b, " NOT NULL");
        }
        if (!PQgetisnull(cols, i, 3)) {
            ds_puts(&b, " DEFAULT ");
            ds_puts(&b, PQgetvalue(cols, i, 3));
        }
        if (i + 1 < ncols || (pk != NULL && PQresultStatus(pk) == PGRES_TUPLES_OK &&
                              PQntuples(pk) > 0)) {
            ds_puts(&b, ",");
        }
        ds_puts(&b, "\n");
    }

    if (pk != NULL && PQresultStatus(pk) == PGRES_TUPLES_OK && PQntuples(pk) > 0) {
        ds_puts(&b, "    PRIMARY KEY (");
        for (int i = 0; i < PQntuples(pk); i++) {
            if (i > 0) {
                ds_puts(&b, ", ");
            }
            ds_ident(&b, PQgetvalue(pk, i, 0));
        }
        ds_puts(&b, ")\n");
    }
    ds_puts(&b, ");");

    PQclear(cols);
    if (pk != NULL) {
        PQclear(pk);
    }

    if (b.oom) {
        free(b.data);
        return DBC_ERR_NOMEM;
    }
    return pg_drv_make_synthetic(b.data, out);
}
