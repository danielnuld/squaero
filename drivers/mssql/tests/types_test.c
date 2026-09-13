#include "types.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for SQL Server type mapping and date/time formatting. */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static int formats(int type, mssql_datetime_parts p, const char *want)
{
    char buf[64];
    return mssql_format_datetime(type, &p, buf, sizeof buf) == 1 && strcmp(buf, want) == 0;
}

int main(void)
{
    EXPECT(mssql_type_to_neutral(MSSQL_T_INT4) == DBC_TYPE_INT, "int");
    EXPECT(mssql_type_to_neutral(MSSQL_T_INT8) == DBC_TYPE_INT, "bigint");
    EXPECT(mssql_type_to_neutral(MSSQL_T_INTN) == DBC_TYPE_INT, "nullable int");
    EXPECT(mssql_type_to_neutral(MSSQL_T_NUMERIC) == DBC_TYPE_FLOAT, "numeric");
    EXPECT(mssql_type_to_neutral(MSSQL_T_MONEY) == DBC_TYPE_FLOAT, "money");
    EXPECT(mssql_type_to_neutral(MSSQL_T_FLTN) == DBC_TYPE_FLOAT, "nullable float");
    EXPECT(mssql_type_to_neutral(MSSQL_T_BIT) == DBC_TYPE_BOOL, "bit");
    EXPECT(mssql_type_to_neutral(MSSQL_T_BITN) == DBC_TYPE_BOOL, "nullable bit");
    EXPECT(mssql_type_to_neutral(MSSQL_T_VARBINARY) == DBC_TYPE_BLOB, "varbinary");
    EXPECT(mssql_type_to_neutral(MSSQL_T_IMAGE) == DBC_TYPE_BLOB, "image");
    EXPECT(mssql_type_to_neutral(MSSQL_T_MSDATE) == DBC_TYPE_DATE, "date");
    EXPECT(mssql_type_to_neutral(MSSQL_T_MSTIME) == DBC_TYPE_TIME, "time");
    EXPECT(mssql_type_to_neutral(MSSQL_T_DATETIME) == DBC_TYPE_TIMESTAMP, "datetime");
    EXPECT(mssql_type_to_neutral(MSSQL_T_MSDATETIME2) == DBC_TYPE_TIMESTAMP, "datetime2");
    EXPECT(mssql_type_to_neutral(MSSQL_T_MSDATETIMEOFFSET) == DBC_TYPE_TIMESTAMP, "datetimeoffset");
    EXPECT(mssql_type_to_neutral(MSSQL_T_NVARCHAR) == DBC_TYPE_TEXT, "nvarchar");
    EXPECT(mssql_type_to_neutral(MSSQL_T_UNIQUE) == DBC_TYPE_TEXT, "uniqueidentifier as text");
    EXPECT(mssql_type_to_neutral(9999) == DBC_TYPE_TEXT, "unknown -> text");

    mssql_datetime_parts p = {2024, 3, 5, 13, 4, 5, 0, 0};
    EXPECT(formats(MSSQL_T_MSDATE, p, "2024-03-05"), "date");
    EXPECT(formats(MSSQL_T_MSTIME, p, "13:04:05"), "time, whole second");
    EXPECT(formats(MSSQL_T_MSDATETIME2, p, "2024-03-05 13:04:05"), "datetime2, whole second");
    EXPECT(formats(MSSQL_T_DATETIME, p, "2024-03-05 13:04:05"), "datetime");

    p.nanosecond = 123000000;
    EXPECT(formats(MSSQL_T_MSDATETIME2, p, "2024-03-05 13:04:05.123"), "fraction trimmed");
    p.nanosecond = 1234567;
    EXPECT(formats(MSSQL_T_MSTIME, p, "13:04:05.001234567"), "leading zeros kept");

    p.nanosecond = 0;
    p.tz_minutes = 90;
    EXPECT(formats(MSSQL_T_MSDATETIMEOFFSET, p, "2024-03-05 13:04:05 +01:30"), "offset east");
    p.tz_minutes = -300;
    EXPECT(formats(MSSQL_T_MSDATETIMEOFFSET, p, "2024-03-05 13:04:05 -05:00"), "offset west");

    char tiny[8];
    EXPECT(mssql_format_datetime(MSSQL_T_MSDATETIME2, &p, tiny, sizeof tiny) == 0, "too small fails");
    EXPECT(mssql_format_datetime(MSSQL_T_NVARCHAR, &p, tiny, sizeof tiny) == 0, "non-date type fails");
    EXPECT(mssql_format_datetime(MSSQL_T_MSDATE, NULL, tiny, sizeof tiny) == 0, "NULL parts fails");

    const unsigned char bytes[] = {0x00, 0xAB, 0x0F};
    char hexbuf[16];
    EXPECT(mssql_format_binary(bytes, 3, hexbuf, sizeof hexbuf) == 1, "binary ok");
    EXPECT(strcmp(hexbuf, "0x00AB0F") == 0, "binary as 0x hex");
    EXPECT(mssql_format_binary(bytes, 0, hexbuf, sizeof hexbuf) == 1, "empty binary ok");
    EXPECT(strcmp(hexbuf, "0x") == 0, "empty binary is 0x");
    EXPECT(mssql_format_binary(bytes, 3, hexbuf, 8) == 0, "binary too small fails");
    EXPECT(mssql_format_binary(bytes, 3, hexbuf, 9) == 1, "binary exact fit ok");

    if (failures == 0) {
        printf("OK: mssql type mapping + date/time formatting (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
