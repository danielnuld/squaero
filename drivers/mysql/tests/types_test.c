#include "types.h"

#include <stdio.h>

/* Unit tests for the MySQL/MariaDB field-type -> neutral type mapping. The
   numeric literals are the stable enum_field_types codes (see types.c). */

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
    EXPECT(mysql_type_to_neutral(1) == DBC_TYPE_INT, "TINY -> int");
    EXPECT(mysql_type_to_neutral(2) == DBC_TYPE_INT, "SHORT -> int");
    EXPECT(mysql_type_to_neutral(3) == DBC_TYPE_INT, "LONG -> int");
    EXPECT(mysql_type_to_neutral(8) == DBC_TYPE_INT, "LONGLONG -> int");
    EXPECT(mysql_type_to_neutral(9) == DBC_TYPE_INT, "INT24 -> int");
    EXPECT(mysql_type_to_neutral(13) == DBC_TYPE_INT, "YEAR -> int");
    EXPECT(mysql_type_to_neutral(16) == DBC_TYPE_INT, "BIT -> int");

    /* Floating / decimal. */
    EXPECT(mysql_type_to_neutral(0) == DBC_TYPE_FLOAT, "DECIMAL -> float");
    EXPECT(mysql_type_to_neutral(246) == DBC_TYPE_FLOAT, "NEWDECIMAL -> float");
    EXPECT(mysql_type_to_neutral(4) == DBC_TYPE_FLOAT, "FLOAT -> float");
    EXPECT(mysql_type_to_neutral(5) == DBC_TYPE_FLOAT, "DOUBLE -> float");

    /* Null type. */
    EXPECT(mysql_type_to_neutral(6) == DBC_TYPE_NULL, "NULL -> null");

    /* Temporal. */
    EXPECT(mysql_type_to_neutral(7) == DBC_TYPE_TIMESTAMP, "TIMESTAMP -> timestamp");
    EXPECT(mysql_type_to_neutral(12) == DBC_TYPE_TIMESTAMP, "DATETIME -> timestamp");
    EXPECT(mysql_type_to_neutral(10) == DBC_TYPE_DATE, "DATE -> date");
    EXPECT(mysql_type_to_neutral(14) == DBC_TYPE_DATE, "NEWDATE -> date");
    EXPECT(mysql_type_to_neutral(11) == DBC_TYPE_TIME, "TIME -> time");

    /* JSON. */
    EXPECT(mysql_type_to_neutral(245) == DBC_TYPE_JSON, "JSON -> json");

    /* Blob family / geometry. */
    EXPECT(mysql_type_to_neutral(249) == DBC_TYPE_BLOB, "TINY_BLOB -> blob");
    EXPECT(mysql_type_to_neutral(252) == DBC_TYPE_BLOB, "BLOB -> blob");
    EXPECT(mysql_type_to_neutral(255) == DBC_TYPE_BLOB, "GEOMETRY -> blob");

    /* Text family. */
    EXPECT(mysql_type_to_neutral(15) == DBC_TYPE_TEXT, "VARCHAR -> text");
    EXPECT(mysql_type_to_neutral(253) == DBC_TYPE_TEXT, "VAR_STRING -> text");
    EXPECT(mysql_type_to_neutral(254) == DBC_TYPE_TEXT, "STRING -> text");
    EXPECT(mysql_type_to_neutral(247) == DBC_TYPE_TEXT, "ENUM -> text");
    EXPECT(mysql_type_to_neutral(248) == DBC_TYPE_TEXT, "SET -> text");

    /* Unknown / future codes fall back to text. */
    EXPECT(mysql_type_to_neutral(9999) == DBC_TYPE_TEXT, "unknown -> text");

    if (failures == 0) {
        printf("OK: mysql type mapping (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
