#ifndef QUAERO_MONGODB_COLUMNS_H
#define QUAERO_MONGODB_COLUMNS_H

/*
 * Column-set accumulator for flattening MongoDB documents into the neutral
 * tabular result model.
 *
 * A collection is schemaless, so the columns of a result set are not known up
 * front: they are the UNION of the top-level field names of the documents on
 * the returned page. The driver scans the page in two phases — first observing
 * every document's top-level keys to build the column set, then emitting each
 * document as a row, placing each field's value in its column and leaving the
 * missing ones NULL. This module owns phase one: the ordered, de-duplicated set
 * of column names.
 *
 * Ordering is deterministic and stable for a given page:
 *   - "_id" is always column 0 (it is present in virtually every document and
 *     conventionally leads it; forcing it first keeps the grid predictable even
 *     when a projection omits it from the first document scanned).
 *   - every other field keeps first-seen order.
 *
 * This logic is engine-agnostic and depends on nothing from libbson/mongoc, so
 * it is fully unit-testable without a MongoDB client installed.
 */

typedef struct mongo_columns mongo_columns;

/* Allocate an empty accumulator, or NULL on OOM. */
mongo_columns *mongo_columns_new(void);

/* Free an accumulator. NULL is a no-op. */
void mongo_columns_free(mongo_columns *c);

/*
 * Record a top-level field name seen in a document. Adding a name that is
 * already present is a no-op (the union is a set). "_id" is hoisted to the
 * front. Returns 0 on success, -1 on OOM (the accumulator is left unchanged).
 *
 * Note: because "_id" hoisting can shift positions, column indices are only
 * stable once observation is complete. Callers observe the whole page first,
 * then read the finalized order via count/name/index_of.
 */
int mongo_columns_observe(mongo_columns *c, const char *name);

/* Number of distinct columns accumulated. */
int mongo_columns_count(const mongo_columns *c);

/* Name of column `idx` (owned by the accumulator), or NULL if out of range. */
const char *mongo_columns_name(const mongo_columns *c, int idx);

/* Index of `name`, or -1 if it was never observed. */
int mongo_columns_index_of(const mongo_columns *c, const char *name);

#endif /* QUAERO_MONGODB_COLUMNS_H */
