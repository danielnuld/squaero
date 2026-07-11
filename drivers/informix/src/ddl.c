#include "internal.h"
#include "utils/types.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * DDL reconstruction (DBC_FEAT_DDL). Informix has no SHOW CREATE, so the CREATE
 * statement is synthesized from the system catalogs:
 *   - a TABLE: columns (name + type rendered from syscolumns.coltype/collength,
 *     see informix_col_type_str) with NOT NULL, plus a PRIMARY KEY clause built
 *     from the 'P' constraint's index columns.
 *   - a VIEW: the stored definition text, concatenated from sysviews.viewtext in
 *     seqno order (Informix already stores the full "create view ... as ..." there).
 * The result is a synthetic one-column ("sql") result, matching get_ddl on the
 * other drivers so the core previews it uniformly.
 */

/* Owned duplicate of s, or NULL on OOM. */
static char *dupstr(const char *s)
{
    size_t n = strlen(s) + 1;
    char *p = malloc(n);
    if (p != NULL) {
        memcpy(p, s, n);
    }
    return p;
}

/* A growable string. sb_add returns 0 on success, -1 on allocation failure. */
struct sbuf {
    char  *p;
    size_t len;
    size_t cap;
};

static int sb_add(struct sbuf *s, const char *t)
{
    size_t n = strlen(t);
    if (s->len + n + 1 > s->cap) {
        size_t nc = s->cap != 0 ? s->cap : 256;
        while (s->len + n + 1 > nc) {
            nc *= 2;
        }
        char *np = realloc(s->p, nc);
        if (np == NULL) {
            return -1;
        }
        s->p = np;
        s->cap = nc;
    }
    memcpy(s->p + s->len, t, n);
    s->len += n;
    s->p[s->len] = '\0';
    return 0;
}

/* Validate and format the optional `db:` qualifier. 0 on success, -1 on a bad
   identifier (reason stashed on c). */
static int build_qualifier(dbc_conn *c, const char *schema, char *buf, size_t cap)
{
    buf[0] = '\0';
    if (schema != NULL && schema[0] != '\0') {
        if (!ifx_is_safe_ident(schema)) {
            ifx_set_err(c, "database name is not a valid identifier");
            return -1;
        }
        snprintf(buf, cap, "%s:", schema);
    }
    return 0;
}

/* Run sql and return an owned copy of the first row's first column, or NULL when
   there is no row / on error / on OOM. */
static char *query_scalar(dbc_conn *c, const char *sql)
{
    dbc_result *r = NULL;
    if (ifx_run(c, sql, &r) != DBC_OK) {
        return NULL;
    }
    char *out = NULL;
    if (ifx_next_row(r) == 1) {
        const char *v = ifx_cell_text(r, 0);
        if (v != NULL) {
            out = dupstr(v);
        }
    }
    ifx_free_result(r);
    return out;
}

/* Append the PRIMARY KEY clause (", PRIMARY KEY (a, b)") to sb when the table has
   one. Returns 0 on success (including "no PK"), -1 on OOM/query failure. */
static int append_primary_key(dbc_conn *c, const char *qualifier,
                              const char *table_lit, struct sbuf *sb)
{
    static const char *const k_pk =
        "SELECT TRIM(c.colname) FROM %ssyscolumns c, %ssystables t, "
        "%ssysconstraints k, %ssysindexes x "
        "WHERE t.tabname = %s AND c.tabid = t.tabid AND k.tabid = t.tabid "
        "AND k.constrtype = 'P' AND x.idxname = k.idxname "
        "AND c.colno IN (ABS(x.part1),ABS(x.part2),ABS(x.part3),ABS(x.part4),"
        "ABS(x.part5),ABS(x.part6),ABS(x.part7),ABS(x.part8),ABS(x.part9),"
        "ABS(x.part10),ABS(x.part11),ABS(x.part12),ABS(x.part13),ABS(x.part14),"
        "ABS(x.part15),ABS(x.part16)) ORDER BY c.colno";

    size_t n = strlen(k_pk) + 4 * strlen(qualifier) + strlen(table_lit) + 1;
    char *sql = malloc(n);
    if (sql == NULL) {
        return -1;
    }
    snprintf(sql, n, k_pk, qualifier, qualifier, qualifier, qualifier, table_lit);

    dbc_result *r = NULL;
    dbc_status st = ifx_run(c, sql, &r);
    free(sql);
    if (st != DBC_OK) {
        return -1;
    }

    int count = 0, rc = 0;
    int row = 0;
    while ((row = ifx_next_row(r)) == 1) {
        const char *name = ifx_cell_text(r, 0);
        if (name == NULL) {
            continue;
        }
        if (sb_add(sb, count == 0 ? ",\n  PRIMARY KEY (" : ", ") != 0 ||
            sb_add(sb, name) != 0) {
            rc = -1;
            break;
        }
        count++;
    }
    if (rc == 0 && row < 0) {
        rc = -1;  /* iteration error */
    }
    if (rc == 0 && count > 0) {
        rc = sb_add(sb, ")");
    }
    ifx_free_result(r);
    return rc;
}

/* Build CREATE TABLE for `object` from its columns + primary key. */
static dbc_status build_table_ddl(dbc_conn *c, const char *qualifier,
                                  const char *object, const char *table_lit,
                                  dbc_result **out)
{
    static const char *const k_cols =
        "SELECT TRIM(c.colname), c.coltype, c.collength "
        "FROM %ssyscolumns c, %ssystables t "
        "WHERE t.tabname = %s AND t.tabid = c.tabid ORDER BY c.colno";

    size_t n = strlen(k_cols) + 2 * strlen(qualifier) + strlen(table_lit) + 1;
    char *sql = malloc(n);
    if (sql == NULL) {
        return DBC_ERR_NOMEM;
    }
    snprintf(sql, n, k_cols, qualifier, qualifier, table_lit);

    dbc_result *r = NULL;
    dbc_status st = ifx_run(c, sql, &r);
    free(sql);
    if (st != DBC_OK) {
        return st;
    }

    struct sbuf sb = {0};
    int rc = sb_add(&sb, "CREATE TABLE ") || sb_add(&sb, object) || sb_add(&sb, " (\n");
    int ncols = 0, row = 0;
    while (rc == 0 && (row = ifx_next_row(r)) == 1) {
        const char *name = ifx_cell_text(r, 0);
        const char *ct   = ifx_cell_text(r, 1);
        const char *cl   = ifx_cell_text(r, 2);
        if (name == NULL || ct == NULL) {
            continue;
        }
        int coltype = atoi(ct);
        int collength = cl != NULL ? atoi(cl) : 0;
        char typebuf[64];
        informix_col_type_str(coltype, collength, typebuf, sizeof typebuf);

        if (ncols > 0) {
            rc = sb_add(&sb, ",\n");
        }
        if (rc == 0) {
            rc = sb_add(&sb, "  ") || sb_add(&sb, name) || sb_add(&sb, " ") ||
                 sb_add(&sb, typebuf);
        }
        /* coltype's 0x100 bit is the NOT NULL flag. */
        if (rc == 0 && (coltype & 256)) {
            rc = sb_add(&sb, " NOT NULL");
        }
        ncols++;
    }
    if (rc == 0 && row < 0) {
        rc = -1;
    }
    ifx_free_result(r);

    if (rc == 0 && ncols == 0) {
        /* No columns found: the object does not exist (or is not a base table). */
        free(sb.p);
        ifx_set_err(c, "unknown table");
        return DBC_ERR_QUERY;
    }
    if (rc == 0) {
        rc = append_primary_key(c, qualifier, table_lit, &sb);
    }
    if (rc == 0) {
        rc = sb_add(&sb, "\n);");
    }
    if (rc != 0) {
        free(sb.p);
        return DBC_ERR_NOMEM;
    }

    dbc_status mk = ifx_make_synthetic_sql(sb.p, out);
    free(sb.p);
    return mk;
}

/* Build CREATE VIEW by concatenating the stored definition text (sysviews). */
static dbc_status build_view_ddl(dbc_conn *c, const char *qualifier,
                                 const char *table_lit, dbc_result **out)
{
    static const char *const k_view =
        "SELECT v.viewtext FROM %ssysviews v, %ssystables t "
        "WHERE t.tabname = %s AND v.tabid = t.tabid ORDER BY v.seqno";

    size_t n = strlen(k_view) + 2 * strlen(qualifier) + strlen(table_lit) + 1;
    char *sql = malloc(n);
    if (sql == NULL) {
        return DBC_ERR_NOMEM;
    }
    snprintf(sql, n, k_view, qualifier, qualifier, table_lit);

    dbc_result *r = NULL;
    dbc_status st = ifx_run(c, sql, &r);
    free(sql);
    if (st != DBC_OK) {
        return st;
    }

    struct sbuf sb = {0};
    int rc = 0, rows = 0, row = 0;
    while (rc == 0 && (row = ifx_next_row(r)) == 1) {
        const char *seg = ifx_cell_text(r, 0);
        if (seg != NULL) {
            rc = sb_add(&sb, seg);
        }
        rows++;
    }
    if (rc == 0 && row < 0) {
        rc = -1;
    }
    ifx_free_result(r);

    if (rc == 0 && rows == 0) {
        free(sb.p);
        ifx_set_err(c, "view definition not available");
        return DBC_ERR_QUERY;
    }
    if (rc != 0) {
        free(sb.p);
        return DBC_ERR_NOMEM;
    }
    dbc_status mk = ifx_make_synthetic_sql(sb.p != NULL ? sb.p : "", out);
    free(sb.p);
    return mk;
}

dbc_status ifx_get_ddl(dbc_conn *c, const char *schema, const char *object,
                       dbc_result **out)
{
    if (out != NULL) {
        *out = NULL;
    }
    if (c == NULL || c->dbc == NULL || object == NULL || object[0] == '\0' ||
        out == NULL) {
        ifx_set_err(c, "object name is required");
        return DBC_ERR_PARAM;
    }

    char qualifier[160];
    if (build_qualifier(c, schema, qualifier, sizeof qualifier) != 0) {
        return DBC_ERR_PARAM;
    }

    char *table_lit = ifx_quote_literal(object);
    if (table_lit == NULL) {
        return DBC_ERR_NOMEM;
    }

    /* Route on the object kind: 'V' is a view, everything else is treated as a
       base table (tabtype 'T'). */
    char type_sql[512];
    snprintf(type_sql, sizeof type_sql,
             "SELECT TRIM(tabtype) FROM %ssystables WHERE tabname = %s",
             qualifier, table_lit);
    char *tabtype = query_scalar(c, type_sql);

    dbc_status st;
    if (tabtype == NULL) {
        ifx_set_err(c, "unknown table or view");
        st = DBC_ERR_QUERY;
    } else if (tabtype[0] == 'V') {
        st = build_view_ddl(c, qualifier, table_lit, out);
    } else {
        st = build_table_ddl(c, qualifier, object, table_lit, out);
    }

    free(tabtype);
    free(table_lit);
    return st;
}
