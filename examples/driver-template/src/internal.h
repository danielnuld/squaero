#ifndef QUAERO_EXAMPLE_DRIVER_INTERNAL_H
#define QUAERO_EXAMPLE_DRIVER_INTERNAL_H

/*
 * Internal definitions shared across the example driver's translation units.
 * Not part of any public surface — the only exported symbol is dbc_driver_entry
 * (see entry.c). Copy this driver as the starting point for a real one and
 * replace the canned result in driver.c with calls to your engine's client
 * library.
 */

#include "dbcore/driver.h"

/*
 * A live connection. A real driver stores the engine handle here (e.g. a
 * `sqlite3 *`, a `MYSQL *`, an ODBC handle). This template has no engine, so it
 * only keeps room for the last error message.
 *
 * The core only ever holds an opaque `dbc_conn *`; the concrete shape is the
 * driver's own.
 */
struct dbc_conn {
    char err[256];  /* human-readable reason for the last failed call */
};

/*
 * A result set. A real driver stores the engine's cursor/statement here plus
 * whatever the result accessors need to walk it. This template serves a fixed,
 * in-memory table (see driver.c), so it only needs a row cursor.
 */
struct dbc_result {
    int row;  /* -1 before the first next_row(); indexes the canned rows after */
};

/* --- driver.c: the required vtable surface ------------------------------- */
dbc_status   example_connect(const char *dsn_json, dbc_conn **out);
void         example_disconnect(dbc_conn *c);
const char  *example_last_error(dbc_conn *c);

dbc_status   example_query(dbc_conn *c, const char *sql, dbc_result **out);
void         example_free_result(dbc_result *r);

int          example_col_count(dbc_result *r);
const char  *example_col_name(dbc_result *r, int col);
dbc_type     example_col_type(dbc_result *r, int col);
int          example_next_row(dbc_result *r);
const char  *example_cell_text(dbc_result *r, int col);
long long    example_rows_affected(dbc_result *r);

#endif /* QUAERO_EXAMPLE_DRIVER_INTERNAL_H */
