#include "bson_types.h"

/*
 * BSON element type markers, mirrored from libbson's bson_type_t (which in turn
 * are the element type bytes defined by the BSON specification, https://bsonspec.org).
 * They are a stable part of the wire/storage format; mirroring them here lets the
 * mapping compile and be tested without the mongo-c-driver headers.
 */
enum {
    BSON_EOD          = 0x00, /* end-of-document marker (not a real value) */
    BSON_DOUBLE       = 0x01,
    BSON_UTF8         = 0x02, /* string */
    BSON_DOCUMENT     = 0x03, /* embedded document */
    BSON_ARRAY        = 0x04,
    BSON_BINARY       = 0x05,
    BSON_UNDEFINED    = 0x06, /* deprecated */
    BSON_OID          = 0x07, /* ObjectId */
    BSON_BOOL         = 0x08,
    BSON_DATE_TIME    = 0x09, /* UTC datetime (ms since epoch) */
    BSON_NULL         = 0x0A,
    BSON_REGEX        = 0x0B,
    BSON_DBPOINTER    = 0x0C, /* deprecated */
    BSON_CODE         = 0x0D, /* JavaScript */
    BSON_SYMBOL       = 0x0E, /* deprecated */
    BSON_CODEWSCOPE   = 0x0F, /* JavaScript with scope */
    BSON_INT32        = 0x10,
    BSON_TIMESTAMP    = 0x11, /* internal MongoDB replication timestamp */
    BSON_INT64        = 0x12,
    BSON_DECIMAL128   = 0x13,
    BSON_MAXKEY       = 0x7F,
    BSON_MINKEY       = 0xFF
};

/*
 * Map a BSON element type to the neutral dbc_type. Notes on the lossy /
 * ambiguous cases:
 *   - Embedded documents and arrays have no scalar neutral counterpart; they are
 *     surfaced as JSON (their canonical Extended-JSON form is exchanged as the
 *     cell text). This is the crux of the flatten decision: nested structure
 *     stays as a JSON cell rather than exploding into more columns.
 *   - ObjectId maps to TEXT (its 24-char hex form). So do regex, JavaScript code
 *     and the deprecated symbol/dbpointer types — their textual form is safe.
 *   - DECIMAL128 is fixed-point; the neutral model has no decimal type, so it
 *     maps to FLOAT (same convention as the MySQL/Informix DECIMAL). Exact
 *     fidelity is preserved by exchanging the textual form.
 *   - The internal replication TIMESTAMP and the UTC DATE_TIME both map to
 *     TIMESTAMP.
 *   - EOD, NULL and the deprecated UNDEFINED map to DBC_TYPE_NULL. (A NULL/absent
 *     cell is still signalled out-of-band by cell_text returning NULL; the type
 *     here only classifies the column.)
 *   - MINKEY/MAXKEY are sentinel bounds with no value; exchanged as TEXT.
 */
dbc_type mongo_bson_type_to_neutral(int bson_type)
{
    switch (bson_type) {
    case BSON_INT32:
    case BSON_INT64:
        return DBC_TYPE_INT;

    case BSON_DOUBLE:
    case BSON_DECIMAL128:
        return DBC_TYPE_FLOAT;

    case BSON_BOOL:
        return DBC_TYPE_BOOL;

    case BSON_DATE_TIME:
    case BSON_TIMESTAMP:
        return DBC_TYPE_TIMESTAMP;

    case BSON_BINARY:
        return DBC_TYPE_BLOB;

    case BSON_DOCUMENT:
    case BSON_ARRAY:
        return DBC_TYPE_JSON;

    case BSON_EOD:
    case BSON_NULL:
    case BSON_UNDEFINED:
        return DBC_TYPE_NULL;

    case BSON_UTF8:
    case BSON_OID:
    case BSON_REGEX:
    case BSON_DBPOINTER:
    case BSON_CODE:
    case BSON_SYMBOL:
    case BSON_CODEWSCOPE:
    case BSON_MINKEY:
    case BSON_MAXKEY:
        return DBC_TYPE_TEXT;

    default:
        /* Unknown/future markers exchange as text (their textual form is safe). */
        return DBC_TYPE_TEXT;
    }
}
