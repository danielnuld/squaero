#include "result.h"

#include <stdlib.h>
#include <string.h>

/*
 * The driver's private definition of the opaque dbc_result. A fully buffered
 * grid: column names + neutral types, and rows of owned cell strings (NULL =
 * SQL NULL). `cursor` tracks next_row iteration (-1 before the first row).
 */
struct dbc_result {
    int        ncols;
    char     **names;   /* [ncols] owned */
    dbc_type  *types;   /* [ncols] */
    int        col_cap;

    int        nrows;
    int        row_cap;
    char    ***rows;    /* [nrows][ncols]; rows[r][c] owned or NULL (SQL NULL) */

    int        cursor;
    long long  affected;
    int        has_result_set;
};

dbc_result *mongo_result_new(void)
{
    dbc_result *r = calloc(1, sizeof *r);
    if (r != NULL) {
        r->cursor = -1;
    }
    return r;
}

int mongo_result_add_column(dbc_result *r, const char *name, dbc_type type)
{
    if (r == NULL || name == NULL) {
        return -1;
    }
    if (r->ncols >= r->col_cap) {
        int cap = r->col_cap == 0 ? 8 : r->col_cap * 2;
        char **nn = realloc(r->names, (size_t)cap * sizeof *nn);
        if (nn == NULL) {
            return -1;
        }
        r->names = nn;
        dbc_type *nt = realloc(r->types, (size_t)cap * sizeof *nt);
        if (nt == NULL) {
            return -1;
        }
        r->types = nt;
        r->col_cap = cap;
    }
    size_t n = strlen(name) + 1;
    char *copy = malloc(n);
    if (copy == NULL) {
        return -1;
    }
    memcpy(copy, name, n);
    r->names[r->ncols] = copy;
    r->types[r->ncols] = type;
    r->ncols++;
    r->has_result_set = 1;
    return 0;
}

void mongo_result_set_col_type(dbc_result *r, int idx, dbc_type type)
{
    if (r == NULL || idx < 0 || idx >= r->ncols) {
        return;
    }
    r->types[idx] = type;
}

int mongo_result_add_row(dbc_result *r, char **cells)
{
    if (r == NULL || cells == NULL) {
        return -1;
    }
    if (r->nrows >= r->row_cap) {
        int cap = r->row_cap == 0 ? 16 : r->row_cap * 2;
        char ***nr = realloc(r->rows, (size_t)cap * sizeof *nr);
        if (nr == NULL) {
            return -1;
        }
        r->rows = nr;
        r->row_cap = cap;
    }
    r->rows[r->nrows] = cells;
    r->nrows++;
    return 0;
}

void mongo_result_set_affected(dbc_result *r, long long affected)
{
    if (r != NULL) {
        r->affected = affected;
    }
}

void mongo_free_result(dbc_result *r)
{
    if (r == NULL) {
        return;
    }
    for (int i = 0; i < r->ncols; i++) {
        free(r->names[i]);
    }
    free(r->names);
    free(r->types);
    for (int i = 0; i < r->nrows; i++) {
        char **row = r->rows[i];
        if (row != NULL) {
            for (int c = 0; c < r->ncols; c++) {
                free(row[c]);
            }
            free(row);
        }
    }
    free(r->rows);
    free(r);
}

int mongo_col_count(dbc_result *r)
{
    return r != NULL ? r->ncols : 0;
}

const char *mongo_col_name(dbc_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->ncols) {
        return NULL;
    }
    return r->names[col];
}

dbc_type mongo_col_type(dbc_result *r, int col)
{
    if (r == NULL || col < 0 || col >= r->ncols) {
        return DBC_TYPE_NULL;
    }
    return r->types[col];
}

int mongo_next_row(dbc_result *r)
{
    if (r == NULL || r->cursor + 1 >= r->nrows) {
        return 0;
    }
    r->cursor++;
    return 1;
}

const char *mongo_cell_text(dbc_result *r, int col)
{
    if (r == NULL || r->cursor < 0 || r->cursor >= r->nrows ||
        col < 0 || col >= r->ncols) {
        return NULL;
    }
    return r->rows[r->cursor][col];
}

long long mongo_rows_affected(dbc_result *r)
{
    return r != NULL ? r->affected : 0;
}

const char *mongo_type_name(dbc_type type)
{
    switch (type) {
    case DBC_TYPE_INT:       return "int";
    case DBC_TYPE_FLOAT:     return "float";
    case DBC_TYPE_BOOL:      return "bool";
    case DBC_TYPE_TEXT:      return "text";
    case DBC_TYPE_BLOB:      return "blob";
    case DBC_TYPE_DATE:      return "date";
    case DBC_TYPE_TIME:      return "time";
    case DBC_TYPE_TIMESTAMP: return "timestamp";
    case DBC_TYPE_JSON:      return "json";
    case DBC_TYPE_NULL:      return "null";
    default:                 return "text";
    }
}
