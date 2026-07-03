#include "bson_types.h"

#include <stdio.h>

/* Unit tests for the BSON element type -> neutral type mapping. The numeric
   literals are the stable BSON element type bytes mirrored in bson_types.c
   (libbson's bson_type_t / the BSON spec). */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

int main(void)
{
    /* Integers. */
    EXPECT(mongo_bson_type_to_neutral(0x10) == DBC_TYPE_INT, "int32 -> int");
    EXPECT(mongo_bson_type_to_neutral(0x12) == DBC_TYPE_INT, "int64 -> int");

    /* Floating / fixed-point. */
    EXPECT(mongo_bson_type_to_neutral(0x01) == DBC_TYPE_FLOAT, "double -> float");
    EXPECT(mongo_bson_type_to_neutral(0x13) == DBC_TYPE_FLOAT, "decimal128 -> float");

    /* Boolean. */
    EXPECT(mongo_bson_type_to_neutral(0x08) == DBC_TYPE_BOOL, "bool -> bool");

    /* Temporal: both the UTC datetime and the internal replication timestamp. */
    EXPECT(mongo_bson_type_to_neutral(0x09) == DBC_TYPE_TIMESTAMP, "date_time -> timestamp");
    EXPECT(mongo_bson_type_to_neutral(0x11) == DBC_TYPE_TIMESTAMP, "timestamp -> timestamp");

    /* Binary large object. */
    EXPECT(mongo_bson_type_to_neutral(0x05) == DBC_TYPE_BLOB, "binary -> blob");

    /* Nested structure is exchanged as JSON (the flatten decision). */
    EXPECT(mongo_bson_type_to_neutral(0x03) == DBC_TYPE_JSON, "document -> json");
    EXPECT(mongo_bson_type_to_neutral(0x04) == DBC_TYPE_JSON, "array -> json");

    /* Null-ish: EOD, explicit null, deprecated undefined. */
    EXPECT(mongo_bson_type_to_neutral(0x00) == DBC_TYPE_NULL, "eod -> null");
    EXPECT(mongo_bson_type_to_neutral(0x0A) == DBC_TYPE_NULL, "null -> null");
    EXPECT(mongo_bson_type_to_neutral(0x06) == DBC_TYPE_NULL, "undefined -> null");

    /* Text family: string, ObjectId, regex, code, deprecated symbol/dbpointer. */
    EXPECT(mongo_bson_type_to_neutral(0x02) == DBC_TYPE_TEXT, "utf8 -> text");
    EXPECT(mongo_bson_type_to_neutral(0x07) == DBC_TYPE_TEXT, "oid -> text");
    EXPECT(mongo_bson_type_to_neutral(0x0B) == DBC_TYPE_TEXT, "regex -> text");
    EXPECT(mongo_bson_type_to_neutral(0x0C) == DBC_TYPE_TEXT, "dbpointer -> text");
    EXPECT(mongo_bson_type_to_neutral(0x0D) == DBC_TYPE_TEXT, "code -> text");
    EXPECT(mongo_bson_type_to_neutral(0x0E) == DBC_TYPE_TEXT, "symbol -> text");
    EXPECT(mongo_bson_type_to_neutral(0x0F) == DBC_TYPE_TEXT, "code_w_scope -> text");

    /* Sentinel min/max keys have no value; exchanged as text. */
    EXPECT(mongo_bson_type_to_neutral(0x7F) == DBC_TYPE_TEXT, "maxkey -> text");
    EXPECT(mongo_bson_type_to_neutral(0xFF) == DBC_TYPE_TEXT, "minkey -> text");

    /* Unknown / future markers fall back to text. */
    EXPECT(mongo_bson_type_to_neutral(0x55) == DBC_TYPE_TEXT, "unknown -> text");

    if (failures == 0) {
        printf("OK: mongodb bson type mapping (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
