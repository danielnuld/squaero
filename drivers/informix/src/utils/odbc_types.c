#include "odbc_types.h"

/*
 * ODBC SQL type codes, mirrored from sql.h / sqlext.h. They are a stable part
 * of the ODBC interface; mirroring them here keeps the mapping compilable and
 * testable without the ODBC headers (the same approach types.c uses for the
 * Informix native codes). The negative-valued codes are the extended types
 * defined in sqlext.h.
 */
enum {
    ODBC_SQL_UNKNOWN_TYPE  = 0,
    ODBC_SQL_CHAR          = 1,
    ODBC_SQL_NUMERIC       = 2,
    ODBC_SQL_DECIMAL       = 3,
    ODBC_SQL_INTEGER       = 4,
    ODBC_SQL_SMALLINT      = 5,
    ODBC_SQL_FLOAT         = 6,
    ODBC_SQL_REAL          = 7,
    ODBC_SQL_DOUBLE        = 8,
    ODBC_SQL_DATETIME      = 9,   /* ODBC 2.x SQL_DATE (concise) */
    ODBC_SQL_TIME          = 10,  /* ODBC 2.x SQL_TIME */
    ODBC_SQL_TIMESTAMP     = 11,  /* ODBC 2.x SQL_TIMESTAMP */
    ODBC_SQL_VARCHAR       = 12,

    ODBC_SQL_TYPE_DATE      = 91,
    ODBC_SQL_TYPE_TIME      = 92,
    ODBC_SQL_TYPE_TIMESTAMP = 93,

    /* Interval concise types (SQL_INTERVAL_YEAR .. _MINUTE_TO_SECOND). */
    ODBC_SQL_INTERVAL_FIRST = 101,
    ODBC_SQL_INTERVAL_LAST  = 113,

    ODBC_SQL_LONGVARCHAR    = -1,
    ODBC_SQL_BINARY         = -2,
    ODBC_SQL_VARBINARY      = -3,
    ODBC_SQL_LONGVARBINARY  = -4,
    ODBC_SQL_BIGINT         = -5,
    ODBC_SQL_TINYINT        = -6,
    ODBC_SQL_BIT            = -7,
    ODBC_SQL_WCHAR          = -8,
    ODBC_SQL_WVARCHAR       = -9,
    ODBC_SQL_WLONGVARCHAR   = -10,
    ODBC_SQL_GUID           = -11
};

/*
 * Map an ODBC SQL type code (as returned by SQLDescribeCol) to the neutral
 * dbc_type. Notes on the lossy cases:
 *   - DECIMAL/NUMERIC and the real/float family all map to FLOAT; the neutral
 *     model has no fixed-point type. Informix DECIMAL/MONEY surface as
 *     SQL_DECIMAL, SMALLFLOAT as SQL_REAL, FLOAT as SQL_DOUBLE.
 *   - INTERVAL types have no neutral counterpart; their textual form is TEXT.
 *   - Wide-char and GUID types exchange as TEXT.
 */
dbc_type informix_odbc_type_to_neutral(int odbc_sql_type)
{
    if (odbc_sql_type >= ODBC_SQL_INTERVAL_FIRST &&
        odbc_sql_type <= ODBC_SQL_INTERVAL_LAST) {
        return DBC_TYPE_TEXT;  /* INTERVAL YEAR..MINUTE TO SECOND */
    }

    switch (odbc_sql_type) {
    case ODBC_SQL_TINYINT:
    case ODBC_SQL_SMALLINT:
    case ODBC_SQL_INTEGER:
    case ODBC_SQL_BIGINT:
        return DBC_TYPE_INT;

    case ODBC_SQL_BIT:
        return DBC_TYPE_BOOL;

    case ODBC_SQL_NUMERIC:
    case ODBC_SQL_DECIMAL:
    case ODBC_SQL_FLOAT:
    case ODBC_SQL_REAL:
    case ODBC_SQL_DOUBLE:
        return DBC_TYPE_FLOAT;

    case ODBC_SQL_TYPE_DATE:
    case ODBC_SQL_DATETIME:   /* legacy SQL_DATE */
        return DBC_TYPE_DATE;

    case ODBC_SQL_TYPE_TIME:
    case ODBC_SQL_TIME:       /* legacy SQL_TIME */
        return DBC_TYPE_TIME;

    case ODBC_SQL_TYPE_TIMESTAMP:
    case ODBC_SQL_TIMESTAMP:  /* legacy SQL_TIMESTAMP */
        return DBC_TYPE_TIMESTAMP;

    case ODBC_SQL_BINARY:
    case ODBC_SQL_VARBINARY:
    case ODBC_SQL_LONGVARBINARY:
        return DBC_TYPE_BLOB;

    case ODBC_SQL_CHAR:
    case ODBC_SQL_VARCHAR:
    case ODBC_SQL_LONGVARCHAR:
    case ODBC_SQL_WCHAR:
    case ODBC_SQL_WVARCHAR:
    case ODBC_SQL_WLONGVARCHAR:
    case ODBC_SQL_GUID:
        return DBC_TYPE_TEXT;

    default:
        /* Unknown/future codes exchange as text (their textual form is safe). */
        return DBC_TYPE_TEXT;
    }
}
