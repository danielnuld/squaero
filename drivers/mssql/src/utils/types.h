#ifndef QUAERO_MSSQL_TYPES_H
#define QUAERO_MSSQL_TYPES_H

#include "dbcore/driver.h"

#include <stddef.h>

/*
 * SQL Server column types (as db-lib's dbcoltype reports them) mapped to the
 * neutral dbc_type, and the ISO text of the date/time types. Free of FreeTDS so
 * both are unit-tested without the client library: the codes below mirror
 * FreeTDS's SYB* values, and query.c asserts at compile time that they agree.
 */
enum {
    MSSQL_T_IMAGE = 34,
    MSSQL_T_TEXT = 35,
    MSSQL_T_UNIQUE = 36,
    MSSQL_T_VARBINARY = 37,
    MSSQL_T_INTN = 38,
    MSSQL_T_VARCHAR = 39,
    MSSQL_T_MSDATE = 40,
    MSSQL_T_MSTIME = 41,
    MSSQL_T_MSDATETIME2 = 42,
    MSSQL_T_MSDATETIMEOFFSET = 43,
    MSSQL_T_BINARY = 45,
    MSSQL_T_CHAR = 47,
    MSSQL_T_INT1 = 48,
    MSSQL_T_BIT = 50,
    MSSQL_T_INT2 = 52,
    MSSQL_T_INT4 = 56,
    MSSQL_T_DATETIME4 = 58,
    MSSQL_T_REAL = 59,
    MSSQL_T_MONEY = 60,
    MSSQL_T_DATETIME = 61,
    MSSQL_T_FLT8 = 62,
    MSSQL_T_NTEXT = 99,
    MSSQL_T_NVARCHAR = 103,
    MSSQL_T_BITN = 104,
    MSSQL_T_DECIMAL = 106,
    MSSQL_T_NUMERIC = 108,
    MSSQL_T_FLTN = 109,
    MSSQL_T_MONEYN = 110,
    MSSQL_T_DATETIMN = 111,
    MSSQL_T_MONEY4 = 122,
    MSSQL_T_INT8 = 127
};

/* Neutral type of a db-lib column type; anything unrecognised is TEXT, which is
   how its value is delivered anyway. */
dbc_type mssql_type_to_neutral(int coltype);

/* The broken-down parts of a date/time value (db-lib's dbanydatecrack fields,
   with `year` the full year and `month` 1..12). */
typedef struct {
    int year, month, day;
    int hour, minute, second;
    int nanosecond;      /* 0..999999999 */
    int tz_minutes;      /* offset east of UTC, for datetimeoffset */
} mssql_datetime_parts;

/*
 * Write the ISO 8601 text of a date/time value of `coltype` into buf:
 *   date                     -> 2024-03-05
 *   time                     -> 13:04:05[.fraction]
 *   datetime2/datetime/...   -> 2024-03-05 13:04:05[.fraction]
 *   datetimeoffset           -> 2024-03-05 13:04:05[.fraction] +01:30
 * The fraction keeps its significant digits only (trailing zeros dropped), so
 * a whole second has none. Returns 1 on success, 0 when coltype is not a
 * date/time type or buf is too small.
 */
int mssql_format_datetime(int coltype, const mssql_datetime_parts *p,
                          char *buf, size_t cap);

/*
 * Write binary data as `0x` followed by two uppercase hex digits per byte — the
 * form SQL Server itself prints and accepts back as a literal. Needs 2*len+3
 * bytes. Returns 1 on success, 0 when buf is NULL or too small.
 */
int mssql_format_binary(const unsigned char *data, size_t len, char *buf, size_t cap);

#endif /* QUAERO_MSSQL_TYPES_H */
