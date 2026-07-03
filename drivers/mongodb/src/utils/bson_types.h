#ifndef QUAERO_MONGODB_BSON_TYPES_H
#define QUAERO_MONGODB_BSON_TYPES_H

#include "dbcore/driver.h"

/*
 * MongoDB / BSON type mapping.
 *
 * MongoDB is schemaless: a value's type is carried per-field in the BSON of
 * each document, as a one-byte type marker (the `bson_type_t` codes from
 * libbson, which are exactly the element type bytes of the BSON spec). This
 * pure mapper switches on that marker WITHOUT including any libbson header, so
 * the type logic stays unit-testable on a machine that has no mongo-c-driver
 * installed. The codes are mirrored in bson_types.c as named constants.
 *
 * Because a collection has no fixed schema, a column's neutral type is inferred
 * per value while flattening a document (see columns.h): a field that is a
 * number in one document and a string in another simply carries whatever type
 * its value has in each row. The core sends every cell as text regardless, so a
 * mixed-type field is still exchanged losslessly.
 */
dbc_type mongo_bson_type_to_neutral(int bson_type);

#endif /* QUAERO_MONGODB_BSON_TYPES_H */
