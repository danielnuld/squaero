#ifndef QUAERO_MONGODB_DML_H
#define QUAERO_MONGODB_DML_H

#include "dbcore/driver.h"

#include <stddef.h>

/*
 * Render a single-row change (insert / update / delete, see dbc_dml_row) as the
 * mongosh statement the driver itself runs through query():
 *
 *   INSERT  db.<coll>.insertOne({ "a": 1, "b": "x" })
 *   UPDATE  db.<coll>.updateOne(<filter>, { "$set": { "a": 2 } })
 *   DELETE  db.<coll>.deleteOne(<filter>)
 *
 * The document is identified by the where_* columns (the grid sends `_id`). The
 * cells cross as text, so the filter matches every plausible BSON type of the
 * value: a 24-hex-digit `_id` matches the ObjectId and the string, an integer
 * the number and the string, and so on (`$or`, each alternative served by the
 * `_id` index). Values are typed from set_types: INT/FLOAT/BOOL unquoted (when
 * the text is a valid literal, otherwise a string), JSON parsed and embedded,
 * DATE/TIMESTAMP in ISO form as {"$date":..}, everything else a string; with no
 * set_types the type is inferred conservatively (number, true/false, a JSON
 * document/array, else a string). NULL is `null` in an UPDATE; in an INSERT a
 * NULL (or empty `_id`) is left out so the server applies its defaults.
 * `_id` is never written by an UPDATE (it is immutable).
 *
 * Returns a freshly allocated statement (free with free()), or NULL on a bad
 * request -- no collection, no columns to write, no where column for
 * UPDATE/DELETE (refusing to touch more than the targeted document), a JSON cell
 * that is not valid JSON, a collection name that cannot be addressed -- writing
 * the reason into errbuf; also NULL on out-of-memory. Pure: no libbson/mongoc.
 */
char *mongo_build_dml(dbc_dml_kind kind, const dbc_dml_row *row,
                      char *errbuf, size_t errlen);

#endif /* QUAERO_MONGODB_DML_H */
