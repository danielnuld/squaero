#include "types.h"

#include <stdio.h>
#include <string.h>

dbc_type mssql_type_to_neutral(int coltype)
{
    switch (coltype) {
    case MSSQL_T_INT1:
    case MSSQL_T_INT2:
    case MSSQL_T_INT4:
    case MSSQL_T_INT8:
    case MSSQL_T_INTN:
        return DBC_TYPE_INT;
    case MSSQL_T_REAL:
    case MSSQL_T_FLT8:
    case MSSQL_T_FLTN:
    case MSSQL_T_DECIMAL:
    case MSSQL_T_NUMERIC:
    case MSSQL_T_MONEY:
    case MSSQL_T_MONEY4:
    case MSSQL_T_MONEYN:
        return DBC_TYPE_FLOAT;
    case MSSQL_T_BIT:
    case MSSQL_T_BITN:
        return DBC_TYPE_BOOL;
    case MSSQL_T_IMAGE:
    case MSSQL_T_BINARY:
    case MSSQL_T_VARBINARY:
        return DBC_TYPE_BLOB;
    case MSSQL_T_MSDATE:
        return DBC_TYPE_DATE;
    case MSSQL_T_MSTIME:
        return DBC_TYPE_TIME;
    case MSSQL_T_DATETIME:
    case MSSQL_T_DATETIME4:
    case MSSQL_T_DATETIMN:
    case MSSQL_T_MSDATETIME2:
    case MSSQL_T_MSDATETIMEOFFSET:
        return DBC_TYPE_TIMESTAMP;
    default:
        return DBC_TYPE_TEXT;
    }
}

/* ".123" for 123000000 ns: the fraction with its trailing zeros dropped, or ""
   for a whole second. */
static void fraction(int nanosecond, char *out, size_t cap)
{
    out[0] = '\0';
    if (nanosecond <= 0 || nanosecond > 999999999) {
        return;
    }
    char digits[16];
    snprintf(digits, sizeof digits, "%09d", nanosecond);
    size_t n = strlen(digits);
    while (n > 0 && digits[n - 1] == '0') {
        n--;
    }
    digits[n] = '\0';
    snprintf(out, cap, ".%s", digits);
}

int mssql_format_datetime(int coltype, const mssql_datetime_parts *p,
                          char *buf, size_t cap)
{
    if (p == NULL || buf == NULL || cap == 0) {
        return 0;
    }
    char frac[16];
    fraction(p->nanosecond, frac, sizeof frac);
    int n;
    switch (coltype) {
    case MSSQL_T_MSDATE:
        n = snprintf(buf, cap, "%04d-%02d-%02d", p->year, p->month, p->day);
        break;
    case MSSQL_T_MSTIME:
        n = snprintf(buf, cap, "%02d:%02d:%02d%s", p->hour, p->minute, p->second, frac);
        break;
    case MSSQL_T_DATETIME:
    case MSSQL_T_DATETIME4:
    case MSSQL_T_DATETIMN:
    case MSSQL_T_MSDATETIME2:
        n = snprintf(buf, cap, "%04d-%02d-%02d %02d:%02d:%02d%s", p->year, p->month,
                     p->day, p->hour, p->minute, p->second, frac);
        break;
    case MSSQL_T_MSDATETIMEOFFSET: {
        int off = p->tz_minutes < 0 ? -p->tz_minutes : p->tz_minutes;
        n = snprintf(buf, cap, "%04d-%02d-%02d %02d:%02d:%02d%s %c%02d:%02d", p->year,
                     p->month, p->day, p->hour, p->minute, p->second, frac,
                     p->tz_minutes < 0 ? '-' : '+', off / 60, off % 60);
        break;
    }
    default:
        return 0;
    }
    return n > 0 && (size_t)n < cap;
}

int mssql_format_binary(const unsigned char *data, size_t len, char *buf, size_t cap)
{
    static const char hex[] = "0123456789ABCDEF";
    if (buf == NULL || (data == NULL && len > 0) || cap < 2 * len + 3) {
        return 0;
    }
    buf[0] = '0';
    buf[1] = 'x';
    for (size_t i = 0; i < len; i++) {
        buf[2 + 2 * i] = hex[data[i] >> 4];
        buf[3 + 2 * i] = hex[data[i] & 0x0F];
    }
    buf[2 + 2 * len] = '\0';
    return 1;
}
