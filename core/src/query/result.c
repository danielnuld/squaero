#include "result_priv.h"

#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/*
 * Result-set storage and accessors. Cells are kept in a single row-major array
 * of owned strings (cells[row * col_count + col]); a NULL entry means SQL NULL.
 */

struct dbcore_result {
    int        col_count;
    char     **col_names;   /* col_count owned strings (NULL array if 0 cols) */
    dbc_type  *col_types;   /* col_count entries */
    int        row_count;
    int        row_cap;     /* rows the cells array can hold */
    char     **cells;       /* row_cap * col_count owned strings or NULL */
    long long  rows_affected;
    int        truncated;
};

dbcore_result *dbcore_result_create(int col_count)
{
    if (col_count < 0) {
        return NULL;
    }
    dbcore_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        return NULL;
    }
    r->col_count = col_count;
    if (col_count > 0) {
        r->col_names = calloc((size_t)col_count, sizeof *r->col_names);
        r->col_types = calloc((size_t)col_count, sizeof *r->col_types);
        if (r->col_names == NULL || r->col_types == NULL) {
            dbcore_result_free(r);
            return NULL;
        }
    }
    return r;
}

int dbcore_result_set_column(dbcore_result *r, int col, const char *name,
                             dbc_type type)
{
    if (r == NULL || col < 0 || col >= r->col_count) {
        return 0;
    }
    char *copy = NULL;
    if (name != NULL) {
        size_t n = strlen(name) + 1;
        copy = malloc(n);
        if (copy == NULL) {
            return 0;
        }
        memcpy(copy, name, n);
    }
    free(r->col_names[col]);
    r->col_names[col] = copy;
    r->col_types[col] = type;
    return 1;
}

static char *dup_cell(const char *s)
{
    size_t n = strlen(s) + 1;
    char *copy = malloc(n);
    if (copy != NULL) {
        memcpy(copy, s, n);
    }
    return copy;
}

int dbcore_result_add_row(dbcore_result *r, const char *const *cells)
{
    if (r == NULL) {
        return 0;
    }
    if (r->col_count == 0) {
        /* A row with no columns carries no data; just bump the count. */
        r->row_count++;
        return 1;
    }

    if (r->row_count == r->row_cap) {
        /* Grow in size_t and guard the row*col cell-count multiply (and the
           cast back to the int row_cap) against overflow. col_count > 0 here. */
        size_t newcap = r->row_cap == 0 ? 8u : (size_t)r->row_cap * 2u;
        size_t per_row = (size_t)r->col_count * sizeof(*r->cells);
        if (newcap > (size_t)INT_MAX || newcap > SIZE_MAX / per_row) {
            return 0;
        }
        char **grown = realloc(r->cells, newcap * per_row);
        if (grown == NULL) {
            return 0;
        }
        r->cells = grown;
        r->row_cap = (int)newcap;
    }

    char **dst = &r->cells[(size_t)r->row_count * (size_t)r->col_count];
    for (int c = 0; c < r->col_count; c++) {
        if (cells != NULL && cells[c] != NULL) {
            dst[c] = dup_cell(cells[c]);
            if (dst[c] == NULL) {
                /* Roll back the cells copied so far for this row. row_count is
                   not yet bumped, so these slots stay invisible to accessors
                   and dbcore_result_free (which walks only row_count rows, even
                   though row_cap may be larger). */
                for (int k = 0; k < c; k++) {
                    free(dst[k]);
                    dst[k] = NULL;
                }
                return 0;
            }
        } else {
            dst[c] = NULL;  /* SQL NULL */
        }
    }
    r->row_count++;
    return 1;
}

void dbcore_result_set_rows_affected(dbcore_result *r, long long n)
{
    if (r != NULL) {
        r->rows_affected = n;
    }
}

void dbcore_result_set_truncated(dbcore_result *r, int truncated)
{
    if (r != NULL) {
        r->truncated = truncated ? 1 : 0;
    }
}

/* --- public accessors --- */

int dbcore_result_col_count(const dbcore_result *r)
{
    return r != NULL ? r->col_count : 0;
}

const char *dbcore_result_col_name(const dbcore_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->col_count) {
        return NULL;
    }
    return r->col_names[col];
}

dbc_type dbcore_result_col_type(const dbcore_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->col_count) {
        return DBC_TYPE_NULL;
    }
    return r->col_types[col];
}

int dbcore_result_row_count(const dbcore_result *r)
{
    return r != NULL ? r->row_count : 0;
}

const char *dbcore_result_cell(const dbcore_result *r, int row, int col)
{
    if (r == NULL || row < 0 || row >= r->row_count ||
        col < 0 || col >= r->col_count) {
        return NULL;
    }
    return r->cells[(size_t)row * (size_t)r->col_count + (size_t)col];
}

int dbcore_result_cell_is_null(const dbcore_result *r, int row, int col)
{
    if (r == NULL || row < 0 || row >= r->row_count ||
        col < 0 || col >= r->col_count) {
        return 1;
    }
    return r->cells[(size_t)row * (size_t)r->col_count + (size_t)col] == NULL;
}

long long dbcore_result_rows_affected(const dbcore_result *r)
{
    return r != NULL ? r->rows_affected : 0;
}

int dbcore_result_truncated(const dbcore_result *r)
{
    return r != NULL ? r->truncated : 0;
}

int dbcore_result_has_result_set(const dbcore_result *r)
{
    return (r != NULL && r->col_count > 0) ? 1 : 0;
}

void dbcore_result_free(dbcore_result *r)
{
    if (r == NULL) {
        return;
    }
    if (r->col_names != NULL) {
        for (int c = 0; c < r->col_count; c++) {
            free(r->col_names[c]);
        }
        free(r->col_names);
    }
    free(r->col_types);
    if (r->cells != NULL) {
        size_t total = (size_t)r->row_count * (size_t)r->col_count;
        for (size_t i = 0; i < total; i++) {
            free(r->cells[i]);
        }
        free(r->cells);
    }
    free(r);
}
