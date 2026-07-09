#include "types.h"

/*
 * MySQL / MariaDB `enum enum_field_types` codes, mirrored from mysql.h. They are
 * a stable part of the client ABI; mirroring them here lets the mapping be
 * compiled and tested without the client headers. Internal-only temporal codes
 * (NEWDATE/TIMESTAMP2/DATETIME2/TIME2) are included for completeness — the
 * server can surface them in some paths.
 */
enum {
    MYSQL_TYPE_DECIMAL     = 0,
    MYSQL_TYPE_TINY        = 1,
    MYSQL_TYPE_SHORT       = 2,
    MYSQL_TYPE_LONG        = 3,
    MYSQL_TYPE_FLOAT       = 4,
    MYSQL_TYPE_DOUBLE      = 5,
    MYSQL_TYPE_NULL        = 6,
    MYSQL_TYPE_TIMESTAMP   = 7,
    MYSQL_TYPE_LONGLONG    = 8,
    MYSQL_TYPE_INT24       = 9,
    MYSQL_TYPE_DATE        = 10,
    MYSQL_TYPE_TIME        = 11,
    MYSQL_TYPE_DATETIME    = 12,
    MYSQL_TYPE_YEAR        = 13,
    MYSQL_TYPE_NEWDATE     = 14,
    MYSQL_TYPE_VARCHAR     = 15,
    MYSQL_TYPE_BIT         = 16,
    MYSQL_TYPE_TIMESTAMP2  = 17,
    MYSQL_TYPE_DATETIME2   = 18,
    MYSQL_TYPE_TIME2       = 19,
    MYSQL_TYPE_JSON        = 245,
    MYSQL_TYPE_NEWDECIMAL  = 246,
    MYSQL_TYPE_ENUM        = 247,
    MYSQL_TYPE_SET         = 248,
    MYSQL_TYPE_TINY_BLOB   = 249,
    MYSQL_TYPE_MEDIUM_BLOB = 250,
    MYSQL_TYPE_LONG_BLOB   = 251,
    MYSQL_TYPE_BLOB        = 252,
    MYSQL_TYPE_VAR_STRING  = 253,
    MYSQL_TYPE_STRING      = 254,
    MYSQL_TYPE_GEOMETRY    = 255
};

/*
 * Map a MySQL field type code to the neutral dbc_type. Notes on the inherently
 * ambiguous cases (resolved later in the query layer with extra metadata):
 *   - TINYINT(1) is conventionally boolean, but the type code is just TINY; the
 *     length/flags needed to detect that are not available here, so TINY -> int.
 *   - BLOB-family codes also back TEXT columns; text-vs-binary is decided by the
 *     column charset (binary == blob) in the driver, not from the code alone.
 */
dbc_type mysql_type_to_neutral(int mysql_type)
{
    switch (mysql_type) {
    case MYSQL_TYPE_TINY:
    case MYSQL_TYPE_SHORT:
    case MYSQL_TYPE_LONG:
    case MYSQL_TYPE_LONGLONG:
    case MYSQL_TYPE_INT24:
    case MYSQL_TYPE_YEAR:
    case MYSQL_TYPE_BIT:
        return DBC_TYPE_INT;

    case MYSQL_TYPE_DECIMAL:
    case MYSQL_TYPE_NEWDECIMAL:
    case MYSQL_TYPE_FLOAT:
    case MYSQL_TYPE_DOUBLE:
        return DBC_TYPE_FLOAT;

    case MYSQL_TYPE_NULL:
        return DBC_TYPE_NULL;

    case MYSQL_TYPE_TIMESTAMP:
    case MYSQL_TYPE_TIMESTAMP2:
    case MYSQL_TYPE_DATETIME:
    case MYSQL_TYPE_DATETIME2:
        return DBC_TYPE_TIMESTAMP;

    case MYSQL_TYPE_DATE:
    case MYSQL_TYPE_NEWDATE:
        return DBC_TYPE_DATE;

    case MYSQL_TYPE_TIME:
    case MYSQL_TYPE_TIME2:
        return DBC_TYPE_TIME;

    case MYSQL_TYPE_JSON:
        return DBC_TYPE_JSON;

    case MYSQL_TYPE_TINY_BLOB:
    case MYSQL_TYPE_MEDIUM_BLOB:
    case MYSQL_TYPE_LONG_BLOB:
    case MYSQL_TYPE_BLOB:
    case MYSQL_TYPE_GEOMETRY:
        return DBC_TYPE_BLOB;

    case MYSQL_TYPE_VARCHAR:
    case MYSQL_TYPE_VAR_STRING:
    case MYSQL_TYPE_STRING:
    case MYSQL_TYPE_ENUM:
    case MYSQL_TYPE_SET:
        return DBC_TYPE_TEXT;

    default:
        /* Unknown/future codes exchange as text (their textual form is safe). */
        return DBC_TYPE_TEXT;
    }
}

int mysql_type_is_bit(int mysql_type)
{
    return mysql_type == MYSQL_TYPE_BIT;
}

void mysql_bit_to_decimal(const unsigned char *bytes, size_t len, char *out, size_t outcap)
{
    if (out == NULL || outcap == 0) {
        return;
    }
    unsigned long long v = 0;
    /* MySQL BIT is at most 64 bits (8 bytes); if more arrive, keep the low 8. */
    size_t start = len > 8 ? len - 8 : 0;
    for (size_t i = start; i < len; i++) {
        v = (v << 8) | (unsigned long long)(bytes != NULL ? bytes[i] : 0u);
    }
    /* Base-10 by hand — MinGW's msvcrt printf does not reliably support %llu. */
    char tmp[24];
    int ti = 0;
    do {
        tmp[ti++] = (char)('0' + (int)(v % 10ULL));
        v /= 10ULL;
    } while (v != 0ULL && ti < (int)sizeof tmp);
    size_t oi = 0;
    while (ti > 0 && oi + 1 < outcap) {
        out[oi++] = tmp[--ti];
    }
    out[oi] = '\0';
}
