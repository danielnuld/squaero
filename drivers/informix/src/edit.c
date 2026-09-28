#include "internal.h"
#include "utils/dml.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Data modification (DBC_FEAT_DML). The pure informix_build_dml_sql (utils/dml.c)
 * turns the neutral dbc_dml_row into Informix SQL; here we hand it back as the
 * one-column ("sql") synthetic result the contract requires. The core previews
 * or executes that SQL through the normal query path, so this driver never
 * executes the change itself.
 *
 * Before that, the DATETIME values are fitted to their columns' qualifiers
 * (issue #599): over DRDA they read back with six decimals whatever the column,
 * and Informix refuses that text in a column that ends sooner (-1264). The
 * qualifier is in the catalog, not in the result, so it is looked up here.
 */

#define MAX_DTIME_COLS 64
#define FITTED_CAP 40

typedef struct {
    char name[129];
    int collength;
} dtime_col;

static int same_name(const char *a, const char *b)
{
    for (; *a != '\0' && *b != '\0'; a++, b++) {
        if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) {
            return 0;
        }
    }
    return *a == *b;
}

/* The table's DATETIME columns and their collength; 0 when there are none or
   the catalog could not be read (the values then go as they are). */
static int datetime_columns(dbc_conn *c, const dbc_dml_row *row, dtime_col *cols)
{
    char qualifier[160] = "";
    if (row->schema != NULL && row->schema[0] != '\0') {
        if (!ifx_is_safe_ident(row->schema)) {
            return 0;
        }
        snprintf(qualifier, sizeof qualifier, "%s:", row->schema);
    }
    char *table = ifx_quote_literal(row->table);
    if (table == NULL) {
        return 0;
    }
    char sql[512];
    snprintf(sql, sizeof sql,
             "SELECT TRIM(c.colname), c.collength FROM %ssyscolumns c, %ssystables t "
             "WHERE t.tabname = %s AND t.tabid = c.tabid AND MOD(c.coltype, 256) = 10",
             qualifier, qualifier, table);
    free(table);

    dbc_result *r = NULL;
    int n = 0;
    if (ifx_run(c, sql, &r) == DBC_OK) {
        while (n < MAX_DTIME_COLS && ifx_next_row(r)) {
            const char *name = ifx_cell_text(r, 0);
            const char *len = ifx_cell_text(r, 1);
            if (name == NULL || len == NULL) {
                continue;
            }
            snprintf(cols[n].name, sizeof cols[n].name, "%s", name);
            cols[n].collength = atoi(len);
            n++;
        }
    }
    ifx_free_result(r);
    return n;
}

/* vals[i] fitted in place (into slots) when cols[i] is a DATETIME column. */
static void fit(const char *const *names, const char **vals, int count, const dtime_col *dt, int ndt,
                char (*slots)[FITTED_CAP])
{
    for (int i = 0; i < count; i++) {
        if (vals[i] == NULL) {
            continue;
        }
        for (int k = 0; k < ndt; k++) {
            if (same_name(names[i], dt[k].name) &&
                informix_fit_datetime(vals[i], dt[k].collength, slots[i], FITTED_CAP)) {
                vals[i] = slots[i];
                break;
            }
        }
    }
}

dbc_status ifx_build_dml(dbc_conn *c, dbc_dml_kind kind,
                         const dbc_dml_row *row, dbc_result **out)
{
    *out = NULL;
    if (row == NULL || row->table == NULL || row->table[0] == '\0') {
        return DBC_ERR_PARAM;
    }

    dbc_dml_row fitted = *row;
    const char **set = NULL, **where = NULL;
    char (*set_slots)[FITTED_CAP] = NULL, (*where_slots)[FITTED_CAP] = NULL;
    dtime_col *dt = calloc(MAX_DTIME_COLS, sizeof *dt);
    int ndt = dt != NULL && c != NULL ? datetime_columns(c, row, dt) : 0;
    if (ndt > 0) {
        if (row->n_set > 0) {
            set = malloc((size_t)row->n_set * sizeof *set);
            set_slots = malloc((size_t)row->n_set * sizeof *set_slots);
        }
        if (row->n_where > 0) {
            where = malloc((size_t)row->n_where * sizeof *where);
            where_slots = malloc((size_t)row->n_where * sizeof *where_slots);
        }
        if ((row->n_set > 0 && (set == NULL || set_slots == NULL)) ||
            (row->n_where > 0 && (where == NULL || where_slots == NULL))) {
            ndt = 0; /* out of memory: build it unfitted rather than fail */
        }
    }
    if (ndt > 0) {
        if (set != NULL) {
            memcpy(set, row->set_vals, (size_t)row->n_set * sizeof *set);
            fit(row->set_cols, set, row->n_set, dt, ndt, set_slots);
            fitted.set_vals = set;
        }
        if (where != NULL) {
            memcpy(where, row->where_vals, (size_t)row->n_where * sizeof *where);
            fit(row->where_cols, where, row->n_where, dt, ndt, where_slots);
            fitted.where_vals = where;
        }
    }

    char *sql = informix_build_dml_sql(kind, &fitted);
    free(set);
    free(where);
    free(set_slots);
    free(where_slots);
    free(dt);
    if (sql == NULL) {
        /* Invalid request (missing table / WHERE / SET) or out of memory. */
        return DBC_ERR_PARAM;
    }
    dbc_status st = ifx_make_synthetic_sql(sql, out);
    free(sql);
    return st;
}
