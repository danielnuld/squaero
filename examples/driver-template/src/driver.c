/*
 * Example / template driver — the smallest thing that satisfies the Quaero
 * driver ABI (see core/include/dbcore/driver.h and docs/DRIVER_API.md).
 *
 * It implements ONLY the required members of the vtable and advertises no
 * optional capability (features = 0). Instead of talking to a database engine
 * it serves one fixed in-memory table, so it compiles with no external
 * dependency and demonstrates the read path end to end:
 *
 *     id | name
 *     ---+-------
 *      1 | alice
 *      2 | (NULL)
 *
 * To turn this into a real driver: keep the vtable shape, replace the canned
 * data below with your engine's client calls, and add the optional members
 * (introspection / transactions / DDL / DML) one capability at a time, flipping
 * the matching DBC_FEAT_* bit in entry.c only once a real handler backs it.
 * Look at drivers/sqlite for a complete, minimal reference.
 */

#include "internal.h"

#include <stdio.h>   /* snprintf */
#include <stdlib.h>  /* calloc, free */

/* --- the canned result set ----------------------------------------------- */

#define EXAMPLE_N_COLS 2
#define EXAMPLE_N_ROWS 2

static const char *const k_col_names[EXAMPLE_N_COLS] = { "id", "name" };
static const dbc_type    k_col_types[EXAMPLE_N_COLS] = { DBC_TYPE_INT, DBC_TYPE_TEXT };

/* A NULL cell models SQL NULL (row 2's name); every other cell is its text. */
static const char *const k_cells[EXAMPLE_N_ROWS][EXAMPLE_N_COLS] = {
    { "1", "alice" },
    { "2", NULL },
};

/* --- connection lifecycle ------------------------------------------------- */

dbc_status example_connect(const char *dsn_json, dbc_conn **out)
{
    /*
     * The DSN arrives as a JSON string, e.g. {"host":"...","port":5432}. A real
     * driver parses it (drivers/sqlite uses the vendored cJSON) and opens the
     * engine connection. The template ignores it and always "connects".
     */
    (void)dsn_json;

    if (!out)
        return DBC_ERR_PARAM;

    dbc_conn *c = calloc(1, sizeof(*c));
    if (!c)
        return DBC_ERR_NOMEM;

    *out = c;
    return DBC_OK;
}

void example_disconnect(dbc_conn *c)
{
    free(c);  /* free(NULL) is a no-op, so no guard is needed */
}

const char *example_last_error(dbc_conn *c)
{
    /* Never return NULL: the core prints this on any DBC_ERR_* result. */
    if (!c)
        return "invalid connection";
    return c->err;
}

/* --- execution ------------------------------------------------------------ */

dbc_status example_query(dbc_conn *c, const char *sql, dbc_result **out)
{
    /* A real driver executes `sql`; the template serves its fixed table. */
    (void)sql;

    if (!c || !out)
        return DBC_ERR_PARAM;

    dbc_result *r = calloc(1, sizeof(*r));
    if (!r) {
        snprintf(c->err, sizeof(c->err), "out of memory allocating result");
        return DBC_ERR_NOMEM;
    }

    r->row = -1;  /* positioned before the first row; next_row advances */
    *out = r;
    return DBC_OK;
}

void example_free_result(dbc_result *r)
{
    free(r);
}

/* --- result-set reading --------------------------------------------------- */

int example_col_count(dbc_result *r)
{
    (void)r;
    return EXAMPLE_N_COLS;
}

const char *example_col_name(dbc_result *r, int col)
{
    (void)r;
    if (col < 0 || col >= EXAMPLE_N_COLS)
        return NULL;
    return k_col_names[col];
}

dbc_type example_col_type(dbc_result *r, int col)
{
    (void)r;
    if (col < 0 || col >= EXAMPLE_N_COLS)
        return DBC_TYPE_NULL;
    return k_col_types[col];
}

int example_next_row(dbc_result *r)
{
    if (!r)
        return -1;                 /* <0 signals an error to the core */
    if (r->row + 1 >= EXAMPLE_N_ROWS)
        return 0;                  /* 0 = no more rows */
    r->row++;
    return 1;                      /* 1 = a row is ready to read */
}

const char *example_cell_text(dbc_result *r, int col)
{
    /*
     * Return the cell's text, or NULL for SQL NULL. The pointer is owned by the
     * driver and must stay valid until the next next_row()/free_result(); here
     * it points at static storage, so that always holds.
     */
    if (!r || r->row < 0 || r->row >= EXAMPLE_N_ROWS)
        return NULL;
    if (col < 0 || col >= EXAMPLE_N_COLS)
        return NULL;
    return k_cells[r->row][col];
}

long long example_rows_affected(dbc_result *r)
{
    (void)r;
    return 0;  /* a SELECT affects no rows; DML would report the real count */
}
