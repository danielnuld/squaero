#ifndef QUAERO_MONGODB_RESULT_H
#define QUAERO_MONGODB_RESULT_H

#include "dbcore/driver.h"

/*
 * Materialized result set for the MongoDB driver.
 *
 * MongoDB has no forward-only "statement handle" the core can drain lazily, and
 * flattening documents needs the full column union up front (a later document
 * can introduce a new column), so the driver buffers the whole page: it builds
 * the column set and every cell in query()/metadata, then the vtable readers
 * (`col_*`, `next_row`, `cell_text`) just walk the buffer. Cells are owned
 * strings; a NULL cell is SQL NULL (distinct from an empty string), matching the
 * neutral contract.
 *
 * This module is pure — it depends only on driver.h, never on libbson/mongoc —
 * so the result plumbing is unit-testable without a MongoDB client. The mongoc
 * layers (query.c / metadata.c) turn BSON into the owned cell strings and feed
 * them here; `struct dbc_result` is the driver's private definition of the
 * opaque handle the vtable passes around.
 */

/* Allocate an empty result (has_result_set = 0, rows_affected = 0). NULL OOM. */
dbc_result *mongo_result_new(void);

/*
 * Append a column with `name` (copied) and neutral type `type`. Must be called
 * for every column before any row is added. Returns 0, or -1 on OOM. Adding a
 * column marks the result as having a result set.
 */
int mongo_result_add_column(dbc_result *r, const char *name, dbc_type type);

/* Overwrite the neutral type of an already-added column (schemaless inference
   refines a column's type once its first non-null value is seen). No-op if idx
   is out of range. */
void mongo_result_set_col_type(dbc_result *r, int idx, dbc_type type);

/*
 * Append one row. `cells` must hold exactly col_count() entries; each entry is
 * an owned string (freed by mongo_free_result) or NULL for SQL NULL. On success
 * (returns 0) the result takes ownership of the array and its strings. On OOM
 * (returns -1) ownership is NOT taken — the caller frees `cells`.
 */
int mongo_result_add_row(dbc_result *r, char **cells);

/* Record the affected-row count for a write with no result set. */
void mongo_result_set_affected(dbc_result *r, long long affected);

/* --- vtable readers (wired into the driver's vtable) --- */
void        mongo_free_result(dbc_result *r);
int         mongo_col_count(dbc_result *r);
const char *mongo_col_name(dbc_result *r, int col);
dbc_type    mongo_col_type(dbc_result *r, int col);
int         mongo_next_row(dbc_result *r);
const char *mongo_cell_text(dbc_result *r, int col);
long long   mongo_rows_affected(dbc_result *r);

/* Neutral type name string, matching the core's ipc_type_name
   ("int"/"float"/.../"json"/"null"). Used by describe_table. */
const char *mongo_type_name(dbc_type type);

#endif /* QUAERO_MONGODB_RESULT_H */
