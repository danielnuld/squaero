#include "odbc_types.h"

#include <stdio.h>

/* Unit tests for the ODBC SQL-type -> neutral type mapping. The numeric
   literals are the stable ODBC SQL type codes mirrored in odbc_types.c. */

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
    /* Integers (incl. Informix SERIAL/INT8/BIGINT, surfaced via ODBC codes). */
    EXPECT(informix_odbc_type_to_neutral(-6) == DBC_TYPE_INT, "TINYINT -> int");
    EXPECT(informix_odbc_type_to_neutral(5) == DBC_TYPE_INT, "SMALLINT -> int");
    EXPECT(informix_odbc_type_to_neutral(4) == DBC_TYPE_INT, "INTEGER -> int");
    EXPECT(informix_odbc_type_to_neutral(-5) == DBC_TYPE_INT, "BIGINT -> int");

    /* Boolean. */
    EXPECT(informix_odbc_type_to_neutral(-7) == DBC_TYPE_BOOL, "BIT -> bool");

    /* Floating / fixed-point (DECIMAL, MONEY, SMALLFLOAT, FLOAT). */
    EXPECT(informix_odbc_type_to_neutral(2) == DBC_TYPE_FLOAT, "NUMERIC -> float");
    EXPECT(informix_odbc_type_to_neutral(3) == DBC_TYPE_FLOAT, "DECIMAL -> float");
    EXPECT(informix_odbc_type_to_neutral(6) == DBC_TYPE_FLOAT, "FLOAT -> float");
    EXPECT(informix_odbc_type_to_neutral(7) == DBC_TYPE_FLOAT, "REAL -> float");
    EXPECT(informix_odbc_type_to_neutral(8) == DBC_TYPE_FLOAT, "DOUBLE -> float");

    /* Temporal (ODBC 3.x concise types and the 2.x legacy codes). */
    EXPECT(informix_odbc_type_to_neutral(91) == DBC_TYPE_DATE, "TYPE_DATE -> date");
    EXPECT(informix_odbc_type_to_neutral(9) == DBC_TYPE_DATE, "legacy DATE -> date");
    EXPECT(informix_odbc_type_to_neutral(92) == DBC_TYPE_TIME, "TYPE_TIME -> time");
    EXPECT(informix_odbc_type_to_neutral(10) == DBC_TYPE_TIME, "legacy TIME -> time");
    EXPECT(informix_odbc_type_to_neutral(93) == DBC_TYPE_TIMESTAMP,
           "TYPE_TIMESTAMP -> timestamp");
    EXPECT(informix_odbc_type_to_neutral(11) == DBC_TYPE_TIMESTAMP,
           "legacy TIMESTAMP -> timestamp");

    /* Binary large objects (BYTE/BLOB). */
    EXPECT(informix_odbc_type_to_neutral(-2) == DBC_TYPE_BLOB, "BINARY -> blob");
    EXPECT(informix_odbc_type_to_neutral(-3) == DBC_TYPE_BLOB, "VARBINARY -> blob");
    EXPECT(informix_odbc_type_to_neutral(-4) == DBC_TYPE_BLOB,
           "LONGVARBINARY -> blob");

    /* Character / text family. */
    EXPECT(informix_odbc_type_to_neutral(1) == DBC_TYPE_TEXT, "CHAR -> text");
    EXPECT(informix_odbc_type_to_neutral(12) == DBC_TYPE_TEXT, "VARCHAR -> text");
    EXPECT(informix_odbc_type_to_neutral(-1) == DBC_TYPE_TEXT,
           "LONGVARCHAR (TEXT) -> text");
    EXPECT(informix_odbc_type_to_neutral(-8) == DBC_TYPE_TEXT, "WCHAR -> text");
    EXPECT(informix_odbc_type_to_neutral(-11) == DBC_TYPE_TEXT, "GUID -> text");

    /* INTERVAL family (concise codes 101..113) has no neutral type -> text. */
    EXPECT(informix_odbc_type_to_neutral(101) == DBC_TYPE_TEXT,
           "INTERVAL YEAR -> text");
    EXPECT(informix_odbc_type_to_neutral(107) == DBC_TYPE_TEXT,
           "INTERVAL DAY -> text");
    EXPECT(informix_odbc_type_to_neutral(113) == DBC_TYPE_TEXT,
           "INTERVAL MINUTE TO SECOND -> text");

    /* Unknown / future codes fall back to text. */
    EXPECT(informix_odbc_type_to_neutral(0) == DBC_TYPE_TEXT, "UNKNOWN -> text");
    EXPECT(informix_odbc_type_to_neutral(9999) == DBC_TYPE_TEXT, "unknown -> text");

    if (failures == 0) {
        printf("OK: informix odbc type mapping (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
